import type { Alepha } from "alepha";
import { createContext } from "react";

export const AlephaContext = createContext<Alepha | undefined>(undefined);
