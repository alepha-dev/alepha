/**
 * Child page that throws during render inside a NestedView.
 */
const NestedChildRenderError = () => {
  throw new Error("Nested child render crash: thrown inside NestedView");
};

export default NestedChildRenderError;
