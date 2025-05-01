import { createContext } from "react";

export interface RouterLayerContextValue {
	index: number;
	path: string;
}

export const RouterLayerContext = createContext<
	RouterLayerContextValue | undefined
>(undefined);
