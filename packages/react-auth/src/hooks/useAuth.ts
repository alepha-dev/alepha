import { RouterContext, useAlepha } from "@alepha/react";
import type { UserAccountToken } from "@alepha/security";
import { type HttpVirtualClient, LinkProvider } from "@alepha/server-links";
import { useContext } from "react";
import { ReactAuth } from "../services/ReactAuth.ts";

export const useAuth = (): AuthHook => {
	const alepha = useAlepha();
	const router = useContext(RouterContext);
	if (!router) {
		throw new Error("useAuth must be used within a RouterProvider");
	}
	const context = router.context ?? {};

	return {
		user: context.user,
		logout: () => {
			alepha.inject(ReactAuth).logout();
		},
		login: (_provider?: string) => {
			alepha.inject(ReactAuth).login();
		},
		can: (name: string) => {
			const client = alepha.inject(LinkProvider);
			return client.can(name);
		},
	};
};

export interface AuthHook {
	user?: UserAccountToken;
	logout: () => void;
	login: (provider?: string) => void;
	can: <T extends object>(name: keyof HttpVirtualClient<T>) => boolean;
}
