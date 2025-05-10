import type { Alepha } from "@alepha/core";
import { createContext } from "react";
import type {
	PageReactContext,
	RouterState,
} from "../providers/PageDescriptorProvider.ts";

export interface RouterContextValue {
	alepha: Alepha;
	state: RouterState;
	context: PageReactContext;
}

export const RouterContext = createContext<RouterContextValue | undefined>(
	undefined,
);
