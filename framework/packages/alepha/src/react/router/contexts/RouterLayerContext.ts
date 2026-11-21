import { createContext } from "react";

import type { ErrorHandler } from "../primitives/$page.ts";

export interface RouterLayerContextValue {
  index: number;
  path: string;
  onError: ErrorHandler;
}

// Context exemption: state scoped to a subtree. Each `NestedView` gives its
// descendants the layer they render in, and a page holds several at once.
export const RouterLayerContext = createContext<
  RouterLayerContextValue | undefined
>(undefined);
