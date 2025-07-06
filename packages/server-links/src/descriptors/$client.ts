import { $inject } from "@alepha/core";
import {
	type ClientScope,
	type HttpVirtualClient,
	LinkProvider,
} from "../providers/LinkProvider.ts";

export const $client = <T extends object>(
	scope?: ClientScope,
): HttpVirtualClient<T> => {
	return $inject(LinkProvider).client<T>(scope);
};
