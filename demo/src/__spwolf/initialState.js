"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

exports.default = function () {
  var props = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  return {
    initialState: props.initialState || {},
    entityState: props.initialState || {},
    cachedAsyncFields: {},
    validationFeedback: {},
    canSubmitForm: true
  };
};