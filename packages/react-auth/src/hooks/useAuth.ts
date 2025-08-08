import { useAlepha, useStore } from "@alepha/react";
import { type HttpVirtualClient, LinkProvider } from "@alepha/server-links";
import { ReactAuth } from "../services/ReactAuth.ts";

export const useAuth = <T extends object = any>() => {
	const alepha = useAlepha();
	const [user] = useStore("user");

	return {
		user,
		logout: () => {
			alepha.inject(ReactAuth).logout();
		},
		login: async (
			provider: keyof T,
			options: {
				username?: string;
				password?: string;
				redirect?: string;
				[extra: string]: any;
			} = {},
		) => {
			await alepha.inject(ReactAuth).login(provider as string, options);
		},
		can: <Api extends object = any>(
			name: keyof HttpVirtualClient<Api>,
		): boolean => {
			return alepha.inject(LinkProvider).can(name as string);
		},
	};
};
