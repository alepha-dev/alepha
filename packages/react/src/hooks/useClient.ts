import {
	type ClientScope,
	HttpClient,
	type HttpVirtualClient,
} from "@alepha/server";
import { useInject } from "./useInject.ts";

export const useClient = <T extends object>(
	scope?: ClientScope,
): HttpVirtualClient<T> => {
	return useInject(HttpClient).of<T>();
};
