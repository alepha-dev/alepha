import { createContext } from "react";
import type {
	PageReactContext,
	RouterState,
} from "../providers/PageDescriptorProvider.ts";

export interface RouterContextValue {
	state: RouterState;
	context: PageReactContext;
}

export const RouterContext = createContext<RouterContextValue | undefined>(
	undefined,
);
