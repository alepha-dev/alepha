import type { UserAccountToken } from "@alepha/security";
import { useContext } from "react";
import { RouterContext } from "../contexts/RouterContext.ts";
import { ReactAuth } from "../services/ReactAuth.ts";

export const useAuth = (): AuthHook => {
	const ctx = useContext(RouterContext);
	if (!ctx) {
		throw new Error("useAuth must be used within a RouterContext");
	}

	const args = ctx.args ?? {};

	return {
		user: args.user,
		logout: () => {
			ctx.alepha.get(ReactAuth).logout();
		},
		login: (provider?: string) => {
			ctx.alepha.get(ReactAuth).login();
		},
	};
};

export interface AuthHook {
	user?: UserAccountToken;
	logout: () => void;
	login: (provider?: string) => void;
}
