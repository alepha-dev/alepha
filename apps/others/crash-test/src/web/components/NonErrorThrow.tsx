/**
 * Component that throws a string (non-Error object).
 */
const NonErrorThrow = () => {
  // eslint-disable-next-line no-throw-literal
  throw "This is a plain string, not an Error object";
};

export default NonErrorThrow;
