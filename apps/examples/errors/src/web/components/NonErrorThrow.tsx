/**
 * Component that throws a string (non-Error object).
 */
const NonErrorThrow = () => {
  throw "This is a plain string, not an Error object";
};

export default NonErrorThrow;
