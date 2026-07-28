import type { Service } from "alepha";
import { useMemo } from "react";
import { useAlepha } from "./useAlepha.ts";

/**
 * Hook to inject a service instance.
 * It's a wrapper of `useAlepha().inject(service)` with a memoization.
 */
export const useInject = <T extends object>(service: Service<T>): T => {
  const alepha = useAlepha();
  // Keyed on `service`: with an empty dep array a different service class
  // between renders silently kept the first instance.
  return useMemo(() => alepha.inject(service), [service]);
};
