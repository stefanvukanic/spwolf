import React from 'react';
import PropTypes from 'prop-types';
import debug from './debugHelpers';
import getDiff from './diff';
import { getHash } from './hash';
import getInitialState from './getInitialState';
import {
  flattenSections,
  formOnChangeDepMap,
  formVisibilityDepMap,
  getStateOfDependants
} from './reducers';
import {
  flattenValidationRules,
  getValidateFeedbackForField,
  canSubmitForm
} from './validation';

export const FormHOC = ({ componentMap, wrappers }) => {
  class SpWolfForm extends React.Component {
    constructor(props) {
      super(props);
      this.state = getInitialState(props);
      this.handleChange_ = props.debugOnChange ?
        debug(this, this.handleChange) :
        this.handleChange;
    }

    /**
     * Initialize context
     */
    componentDidMount() {
      this.processContext();
      const { specs } = this.props;
      const { conditionalFields = [] } = specs;
      this.conditionalFields_ = conditionalFields;
      this.elements_ = flattenSections(specs.sections);
      this.validationFeedbackRules_ = flattenValidationRules(this.elements_);
      this.visibilityMap_ = formVisibilityDepMap(this.elements_);
      this.elementsWithOnChangeReset_ = formOnChangeDepMap(this.elements_);
      this.calculateAllConditionalFields();
    }

    /**
     *  exposes getFormState to the wrapping connect()
     *  component via context
     */
    processContext = () => {
      const { defineStateGetter } = this.context;
      defineStateGetter && defineStateGetter(this.getFormState);
    };

    /**
     *
     * @returns {{
     *   initialState: Object,
     *   state: Object,
     *   diff: {diff: Object, detailedDiff: {added: Object, updated: Object, deleted: Object}}
     * }}
     */
    getFormState = () => ({
      initialState: this.state.initialState,
      state: this.state.entityState,
      diff: getDiff(this.state.initialState, this.state.entityState)
    });

    /**
     * Passes the canSubmit boolean to the
     * onCanSubmitFormChange prop.
     * @param {boolean} canSubmit
     */
    updateCanSubmitForm = (canSubmit) => {
      this.props.onCanSubmitFormChange && this.props.onCanSubmitFormChange(canSubmit);
    };

    validateForm = () =>
      this.updateCanSubmitForm(canSubmitForm(
        this.state.entityState,
        this.getFormState,
        this.elements_,
        this.validationFeedbackRules_
      ));

    validateField = (field, checkOnlyIfCheckOnChangeSpecified) => {
      if (this.validationFeedbackRules_[field]) {
        const { validationFeedback } = this.state;
        validationFeedback[field] = getValidateFeedbackForField(
          field,
          this.validationFeedbackRules_[field],
          this.state.entityState,
          checkOnlyIfCheckOnChangeSpecified
        );
        this.setState({ validationFeedback });
      }
    };

    /**
     * @param {string} field
     */
    handleFieldBlur = (field) => {
      this.validateField(field);
    };

    /**
     * Creates a hash based on the values of the keys in the
     * dependants array. Then looks if the value for that hash key
     * is saved in state.cachedAsyncField. Returns it if true, otherwise
     * calls the provided asyncDep function and once the result it generated,
     * caches it and sets the state. (Triggering a re-render.)
     *
     * In the meantime, while the promise is left to execute, the function
     * returns an object with the key `asyncPending` true which lets the
     * input component know the value is currently loading.
     * @param {function} fn
     * @param {Array.<string>} dependants
     * @returns {*}
     */
    evaluateAsyncDep = (fn, dependants) => {
      const state = getStateOfDependants(dependants, this.state.entityState);
      const hash = getHash(state);
      if (this.state.cachedAsyncFields[hash]) {
        return this.state.cachedAsyncFields[hash];
      }
      try {
        fn(state).then((result) => {
          const cache = this.state.cachedAsyncFields;
          cache[hash] = result;
          this.setState({ cachedAsyncFields: cache });
        });
      } catch (err) {
        // TODO
      }
      return { asyncPending: true };
    };

    /**
     * Goes through all of the conditional fields and calculates
     * their values. Finally sets the state.
     * TODO: Need perhaps deep copy?
     */
    calculateAllConditionalFields = () => {
      const prev = Object.assign({}, this.state.entityState);
      const next = this.conditionalFields_.reduce((state, field) =>
        Object.assign({}, state, {
          [field.name]: field.fn(this.state.entityState)
        }), prev);
      this.setState({ entityState: next }, () => {
        this.validateForm();
      });
    };

    /**
     * At minimum, sets the state with the provided key/value
     * pair. It can also:
     *  1. Reset the value of another field if such a
     *  dependency is defined by the spec.
     *  2. Remove a key from the state to avoid an
     *  incorrect diff. (See comment above delete entityState[key].)
     *
     *  As a side effect it will also:
     *  1. Trigger the validation for the field.
     *  2. Call recalculateRelevantConditionalFields() to
     *  allow conditional fields to recalculate.
     *
     * @param {string} key
     * @param {*} value
     */
    handleChange = ({ key, value }) => {
      // Used to reset a field if this behaviour is defined by the spec.
      const withReset = this.elementsWithOnChangeReset_[key] ? {
        [this.elementsWithOnChangeReset_[key]]: undefined,
      } : {};
      const entityState = Object.assign(
        {},
        this.state.entityState,
        withReset,
        { [key]: value }
      );
      /*
       * Remove <key> if it was not in the initial state
       * and now equals undefined. This will register as
       * part of the diff { added: { [key]: undefined } },
       * but it is not really something we want in our diff.
       */
      if (
        !this.state.initialState.hasOwnProperty(key) &&
        value === undefined
      ) {
        delete entityState[key];
      }
      this.setState({ entityState }, () => {
        this.recalculateRelevantConditionalFields(key);
        this.validateField(key, true);
      });
    };

    /**
     * Given the <key> that just changed, recalculate
     * all relevant conditional fields.
     *
     * Side effects:
     * 1. If there are fields that need to be toggled to invisible
     * now that a conditional field has changed to `false`,
     * then this method will reset them to `undefined`.
     * 2. This will trigger validateForm. We use this.timer_ as
     * a debounce mechanism to prevent form validation for 250ms
     * in case another call is made to this function.
     *
     * @param {string} key
     */
    recalculateRelevantConditionalFields = (key) => {
      clearTimeout(this.timer_);
      const prev = Object.assign({}, this.state.entityState);
      const next = this.conditionalFields_.reduce((state, field) => {
        if (field.dependsOn.some(dependant => dependant === key)) {
          const value = field.fn(this.state.entityState);
          let inferredUpdates = {};
          if (value === false) {
            inferredUpdates = (this.visibilityMap_[field.name] || [])
              .reduce((acc, _) =>
                Object.assign({}, acc, { [_]: undefined }), {});
          }
          return Object.assign({}, state, inferredUpdates, { [field.name]: value });
        }
        return state;
      }, prev);
      this.setState({ entityState: next }, () => {
        this.timer_ = setTimeout(() => this.validateForm(), 250);
      });
    };

    render() {
      const { specs, sectionProps } = this.props;
      const { entityState, validationFeedback } = this.state;
      const Form = wrappers.form;
      const Section = wrappers.section;
      return (
        <Form>
          {specs.sections.map((section, i) =>
            <Section
              key={`section-${i}`}
              index={i}
              meta={section.meta || {}}
              {...sectionProps}
            >
              {section.elements.map(({
                 fieldType,
                 existsIf = [],
                 disabledIf,
                 asyncEval,
                 isPresentationalElement,
                 ...otherProps
               }, j) => {
                const FormFieldComponent = componentMap[fieldType];
                const isVisible = existsIf.reduce((acc, cond) => acc && entityState[cond], true);
                const isDisabled = entityState[disabledIf] || false;

                if (!isVisible) {
                  return null;
                }

                if (isPresentationalElement) {
                  const presentationalData = (otherProps.dependsOn || [])
                    .reduce((acc, field) =>
                      Object.assign({}, acc, { [field]: entityState[field] }), {});
                  return <FormFieldComponent key={`field-${j}`} data={presentationalData} />;
                }

                const inferredProps = {};
                if (asyncEval && Array.isArray(asyncEval) && asyncEval.length > 0) {
                  asyncEval.forEach((asyncSpec) => {
                    inferredProps[asyncSpec.key] = this.evaluateAsyncDep(...asyncSpec.config);
                  });
                }
                return (
                  <FormFieldComponent
                    className="margin-bottom-12"
                    key={`field-${j}`}
                    onChange={this.handleChange_}
                    value={entityState[otherProps.name]}
                    onFieldBlur={this.handleFieldBlur}
                    validationFeedback={validationFeedback[otherProps.name]}
                    disabled={isDisabled}
                    {...otherProps}
                    {...inferredProps}
                  />
                );
                })}
            </Section>)}
        </Form>
      );
    }
  }

  SpWolfForm.propTypes = {
    onCanSubmitFormChange: PropTypes.func,
    debugOnChange: PropTypes.bool,
    sectionProps: PropTypes.object,
    specs: PropTypes.shape({
      sections: PropTypes.arrayOf(PropTypes.shape({
        meta: PropTypes.object,
        elements: PropTypes.arrayOf(PropTypes.shape({
          name: PropTypes.string.isRequired,
          fieldType: PropTypes.string.isRequired,
          required: PropTypes.bool,
          isPresentationalElement: PropTypes.bool,
          dependsOn: PropTypes.arrayOf(PropTypes.string),
          existsIf: PropTypes.arrayOf(PropTypes.string),
          disabledIf: PropTypes.string,
          onChangeReset: PropTypes.string,
          validationFeedbackRules: PropTypes.arrayOf(PropTypes.shape({
            type: PropTypes.string.isRequired,
            condition: PropTypes.func.isRequired,
            label: PropTypes.string,
            checkOnChange: PropTypes.bool
          }))
        })).isRequired
      })).isRequired,
      conditionalFields: PropTypes.arrayOf(PropTypes.shape({
        name: PropTypes.string.isRequired,
        fn: PropTypes.func.isRequired,
        dependsOn: PropTypes.arrayOf(PropTypes.string)
      }))
    }).isRequired
  };

  SpWolfForm.defaultProps = {
    onCanSubmitFormChange: undefined,
    debugOnChange: false
  };

  SpWolfForm.contextTypes = {
    defineStateGetter: PropTypes.func
  };

  return SpWolfForm;
};

/**
 * Wrapping a component with connect will give you
 * access to a prop called `getFormState`. See the method
 * by the same name above for more info.
 *
 * @param {React.Component} Component
 * @returns {React.Component}
 */
export const connect = (Component) => {
  class Connected extends React.Component {
    state = { getFormState: undefined };

    defineStateGetter = (cb) => {
      this.setState({ getFormState: cb });
    };

    getChildContext() {
      return {
        defineStateGetter: this.defineStateGetter
      };
    }

    render() {
      return (
        <Component
          getFormState={this.state.getFormState}
          {...(this.props || {})}
        />
      );
    }
  }

  Connected.childContextTypes = {
    defineStateGetter: PropTypes.func
  };
  return Connected;
};
