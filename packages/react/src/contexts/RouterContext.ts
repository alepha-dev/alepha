import type { Alepha, EventEmitter } from "@alepha/core";
import { createContext } from "react";
import type {
	PageReactContext,
	RouterEvents,
	RouterState,
} from "../providers/PageDescriptorProvider.ts";

export interface RouterContextValue {
	alepha: Alepha;
	state: RouterState;
	context: PageReactContext;
	events: EventEmitter<RouterEvents>;
}

export const RouterContext = createContext<RouterContextValue | undefined>(
	undefined,
);
