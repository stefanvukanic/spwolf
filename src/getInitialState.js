/**
 * Returns a state based on the provider props.
 * Used to initialize this.state when component
 * it mounted.
 *
 * @param props
 * @return {{
 *    initialState: Object,
 *    entityState: Object,
 *    cachedAsyncFields: Object,
 *    validationFeedback: Object,
 *    canSubmitForm: boolean
 *  }}
 */

import deepmerge from 'deepmerge';

export default (props = {}) => ({
  initialState: deepmerge({}, props.initialState || {}),
  entityState: deepmerge({}, props.initialState || {}),
  cachedAsyncFields: {},
  validationFeedback: {},
  canSubmitForm: true
});
