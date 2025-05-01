import type { Class } from "@alepha/core";
import { useContext } from "react";
import { RouterContext } from "../contexts/RouterContext";

export const useInject = <T extends object>(clazz: Class<T>): T => {
	const ctx = useContext(RouterContext);
	if (!ctx) {
		throw new Error("useRouter must be used within a <RouterProvider>");
	}

	return ctx.alepha.get(clazz, {
		skipRegistration: true,
	});
};
