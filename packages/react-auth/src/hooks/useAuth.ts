import { RouterContext } from "@alepha/react";
import type { UserAccountToken } from "@alepha/security";
import { type HttpVirtualClient, LinkProvider } from "@alepha/server";
import { useContext } from "react";
import { ReactAuth } from "../services/ReactAuth.ts";

export const useAuth = (): AuthHook => {
	const ctx = useContext(RouterContext);
	if (!ctx) {
		throw new Error("useAuth must be used within a RouterContext");
	}

	const context = ctx.context ?? {};

	return {
		user: context.user,
		logout: () => {
			ctx.alepha.get(ReactAuth).logout();
		},
		login: (_provider?: string) => {
			ctx.alepha.get(ReactAuth).login();
		},
		can: (name: string) => {
			const client = ctx.alepha.get(LinkProvider);
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
