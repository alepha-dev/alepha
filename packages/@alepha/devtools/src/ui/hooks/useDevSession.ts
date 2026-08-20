import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useState } from "react";

export interface DevSessionUser {
  id: string;
  name?: string;
  email?: string;
  username?: string;
  picture?: string;
  roles?: string[];
  realm?: string;
}

export interface UseDevSessionResult {
  user?: DevSessionUser;
  /**
   * True until the first answer arrives. The topbar stays neutral rather than
   * claiming "Not signed in" during the round-trip.
   */
  loading: boolean;
  error?: string;
  reload: () => void;
}

/**
 * Who the inspected application currently considers the caller to be.
 *
 * Devtools holds no credential of its own. It is served from the application's
 * own origin, so the browser attaches the session cookie to every request it
 * makes, and this endpoint reports which user that resolved to. Signing in
 * happens in the application, not here.
 *
 * Refetched on window focus because that is exactly the gesture that follows
 * logging in on another tab; without it the chip would keep showing a stale
 * "Not signed in" until a full reload.
 */
export const useDevSession = (): UseDevSessionResult => {
  const http = useInject(HttpClient);
  const [user, setUser] = useState<DevSessionUser | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      const res = await http.fetch("/__devtools/api/session");
      setUser((res.data as any)?.user);
      setError(undefined);
    } catch (e: any) {
      setUser(undefined);
      setError(e?.message ?? "Failed to read the session");
    } finally {
      setLoading(false);
    }
  }, [http]);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  return { user, loading, error, reload: () => void load() };
};
