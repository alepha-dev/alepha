import type { Alepha } from "@alepha/core";
import { useContext } from "react";
import { RouterContext } from "../contexts/RouterContext.ts";

export const useAlepha = (): Alepha => {
	const routerContext = useContext(RouterContext);
	if (!routerContext) {
		throw new Error("useAlepha must be used within a RouterProvider");
	}

	return routerContext.alepha;
};
