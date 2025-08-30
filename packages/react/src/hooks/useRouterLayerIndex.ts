import { useContext } from "react";
import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";

/**
 * A hook that returns the index of the current router layer.
 */
export const useRouterLayerIndex = (): number => {
	return useContext(RouterLayerContext)?.index ?? 0;
};
