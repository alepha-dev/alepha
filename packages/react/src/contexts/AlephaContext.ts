import type { Alepha } from "@alepha/core";
import { createContext } from "react";

export const AlephaContext = createContext<Alepha | undefined>(undefined);
