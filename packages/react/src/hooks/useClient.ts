import { HttpClient } from "@alepha/server";
import { useInject } from "./useInject.ts";

export const useClient = (): HttpClient => {
	return useInject(HttpClient);
};
