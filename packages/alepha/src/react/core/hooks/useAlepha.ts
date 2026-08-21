import { type Alepha, AlephaError } from "alepha";
import { useContext } from "react";

import { AlephaContext } from "../contexts/AlephaContext.ts";

/**
 * Main Alepha hook.
 *
 * It provides access to the Alepha instance within a React component.
 *
 * With Alepha, you can access the core functionalities of the framework:
 *
 * - alepha.state() for state management
 * - alepha.inject() for dependency injection
 * - alepha.events.emit() for event handling
 * etc...
 */
export const useAlepha = (): Alepha => {
  const alepha = useContext(AlephaContext);
  if (!alepha) {
    throw new AlephaError(
      "Hook 'useAlepha()' must be used within an AlephaContext.Provider",
    );
  }

  return alepha;
};
