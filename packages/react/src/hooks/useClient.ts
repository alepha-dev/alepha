import { HttpClient } from "@alepha/server";
import { useInject } from "./useInject";

export const useClient = (): HttpClient => {
	return useInject(HttpClient);
};
