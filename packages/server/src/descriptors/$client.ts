import { $inject } from "@alepha/core";
import { HttpClient, type HttpVirtualClient } from "../services/HttpClient.ts";

export const $client = <T extends object>(): HttpVirtualClient<T> => {
	return $inject(HttpClient).of<T>();
};
