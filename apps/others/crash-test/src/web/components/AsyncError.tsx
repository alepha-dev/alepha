import { use } from "react";

const failing = Promise.reject(
  new Error("Async crash: promise rejected in component"),
);

/**
 * Component that uses React.use() with a rejected promise.
 */
const AsyncError = () => {
  use(failing);
  return <div>You should never see this.</div>;
};

export default AsyncError;
