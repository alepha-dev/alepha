import type { Service } from "@alepha/core";
import { useMemo } from "react";
import { useAlepha } from "./useAlepha.ts";

/**
 * Hook to inject a service instance.
 * It's a wrapper of `useAlepha().inject(service)` with a memoization.
 */
export const useInject = <T extends object>(service: Service<T>): T => {
  const alepha = useAlepha();
  return useMemo(() => alepha.inject(service), []);
};
