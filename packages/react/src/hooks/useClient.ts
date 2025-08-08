import {
	type ClientScope,
	type HttpVirtualClient,
	LinkProvider,
} from "@alepha/server-links";
import { useInject } from "./useInject.ts";
import { useStore } from "./useStore.ts";

export const useClient = <T extends object>(
	_scope?: ClientScope,
): HttpVirtualClient<T> => {
	useStore("user" as any);
	return useInject(LinkProvider).client<T>();
};
