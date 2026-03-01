import { useState } from "react";

/**
 * Component where useState initializer throws.
 */
const HookError = () => {
  const [value] = useState<string>(() => {
    throw new Error("Hook crash: useState initializer threw");
  });

  return <div>{value}</div>;
};

export default HookError;
