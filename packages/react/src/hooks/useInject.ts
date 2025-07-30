import type { Service } from "@alepha/core";
import { useMemo } from "react";
import { useAlepha } from "./useAlepha.ts";

export const useInject = <T extends object>(service: Service<T>): T => {
	const alepha = useAlepha();

	return useMemo(() => alepha.inject(service), []);
};
