import type { Alepha } from "@alepha/core";
import { createContext } from "react";
import type { PageContext } from "../descriptors/$page.ts";
import type { ReactRouter, RouterState } from "../services/ReactRouter.ts";

export interface RouterContextValue {
	router: ReactRouter;
	alepha: Alepha;
	state: RouterState;
	args: PageContext;
}

export const RouterContext = createContext<RouterContextValue | undefined>(
	undefined,
);
