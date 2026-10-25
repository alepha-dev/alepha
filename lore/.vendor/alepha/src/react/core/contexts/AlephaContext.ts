import type { Alepha } from "alepha";
import { createContext } from "react";

/**
 * React context to provide the Alepha instance throughout the component tree.
 */
export const AlephaContext = createContext<Alepha | undefined>(undefined);
