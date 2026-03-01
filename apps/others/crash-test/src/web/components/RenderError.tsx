/**
 * Component that throws during render.
 */
const RenderError = () => {
  throw new Error(
    "Render exploded: this error was thrown during component render",
  );
};

export default RenderError;
