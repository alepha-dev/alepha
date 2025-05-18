import type { Class } from "@alepha/core";
import { useContext, useMemo } from "react";
import { RouterContext } from "../contexts/RouterContext.ts";

export const useInject = <T extends object>(clazz: Class<T>): T => {
	const ctx = useContext(RouterContext);
	if (!ctx) {
		throw new Error("useRouter must be used within a <RouterProvider>");
	}

	return useMemo(
		() =>
			ctx.alepha.get(clazz, {
				skipRegistration: true,
			}),
		[],
	);
};
