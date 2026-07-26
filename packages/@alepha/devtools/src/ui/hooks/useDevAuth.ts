import { useStore } from "alepha/react";
import { useCallback, useEffect, useRef } from "react";
import { devAuthAtom } from "../atoms/devAuthAtom.ts";

const STORAGE_KEY = "alepha.devtools.auth";

export interface DevAuthValue {
  bearer?: string;
  headers?: Array<{ key: string; value: string }>;
}

export interface UseDevAuthResult {
  auth: DevAuthValue;
  setAuth: (next: DevAuthValue) => void;
  clear: () => void;
  /**
   * Headers to merge into an outgoing Try It request.
   */
  toHeaders: () => Record<string, string>;
  authorized: boolean;
}

/**
 * Read and persist the Try It credentials.
 *
 * Rehydrates from `localStorage` once on mount so a page reload doesn't lose
 * the token mid-session — retyping a JWT for every request is what makes
 * people give up on a Try It feature.
 */
export const useDevAuth = (): UseDevAuthResult => {
  const [auth, setStored] = useStore(devAuthAtom);
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setStored(JSON.parse(raw));
    } catch {
      // Corrupt or unavailable storage is not worth surfacing — the user can
      // simply re-enter the token.
    }
  }, [setStored]);

  const setAuth = useCallback(
    (next: DevAuthValue) => {
      setStored(next);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Non-fatal: the value still applies for this session.
      }
    },
    [setStored],
  );

  const clear = useCallback(() => setAuth({}), [setAuth]);

  const toHeaders = useCallback((): Record<string, string> => {
    const out: Record<string, string> = {};
    if (auth?.bearer?.trim()) {
      out.Authorization = `Bearer ${auth.bearer.trim()}`;
    }
    for (const h of auth?.headers ?? []) {
      if (h.key.trim()) out[h.key.trim()] = h.value;
    }
    return out;
  }, [auth]);

  const authorized = Boolean(
    auth?.bearer?.trim() || (auth?.headers ?? []).some((h) => h.key.trim()),
  );

  return { auth: auth ?? {}, setAuth, clear, toHeaders, authorized };
};
