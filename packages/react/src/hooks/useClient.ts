import {
	type ClientScope,
	type HttpVirtualClient,
	LinkProvider,
} from "@alepha/server-links";
import { useInject } from "./useInject.ts";

export const useClient = <T extends object>(
	_scope?: ClientScope,
): HttpVirtualClient<T> => {
	return useInject(LinkProvider).client<T>();
};
