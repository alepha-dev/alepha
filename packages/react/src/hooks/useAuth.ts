import type { UserAccountToken } from "@alepha/security";
import { useContext } from "react";
import { RouterContext } from "../contexts/RouterContext";
import { Auth } from "../services/Auth";

export const useAuth = (): AuthHook => {
	const ctx = useContext(RouterContext);
	if (!ctx) {
		throw new Error("useAuth must be used within a RouterContext");
	}

	const args = ctx.args ?? {};

	return {
		user: args.user,
		logout: () => {
			ctx.alepha.get(Auth).logout();
		},
		login: (provider?: string) => {
			ctx.alepha.get(Auth).login();
		},
	};
};

export interface AuthHook {
	user?: UserAccountToken;
	logout: () => void;
	login: (provider?: string) => void;
}
