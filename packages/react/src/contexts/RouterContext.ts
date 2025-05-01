import type { Alepha } from "@alepha/core";
import { createContext } from "react";
import type { PageContext } from "../descriptors/$page";
import type { Router, RouterState } from "../services/Router";

export interface RouterContextValue {
	router: Router;
	alepha: Alepha;
	state: RouterState;
	args: PageContext;
}

export const RouterContext = createContext<RouterContextValue | undefined>(
	undefined,
);
