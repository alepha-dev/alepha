/**
 * Component that throws an error with a nested .cause chain (3 levels deep).
 */
const CauseChain = () => {
  const root = new Error("Root cause: database connection refused");
  const mid = new Error("Service layer: failed to fetch user", { cause: root });
  const top = new Error("Page render: could not load data", { cause: mid });

  throw top;
};

export default CauseChain;
