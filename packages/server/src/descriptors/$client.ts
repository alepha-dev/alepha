import { $inject } from "@alepha/core";
import {
	type ClientScope,
	HttpClient,
	type HttpVirtualClient,
} from "../services/HttpClient.ts";

export const $client = <T extends object>(
	scope?: ClientScope,
): HttpVirtualClient<T> => {
	return $inject(HttpClient).of<T>(scope);
};
