import { createContext } from "react";

import type { ErrorHandler } from "../primitives/$page.ts";

export interface RouterLayerContextValue {
  index: number;
  path: string;
  onError: ErrorHandler;
}

export const RouterLayerContext = createContext<
  RouterLayerContextValue | undefined
>(undefined);
