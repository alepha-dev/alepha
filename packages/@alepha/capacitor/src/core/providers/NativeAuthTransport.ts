import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { ReactAuth, ReactAuthTransport } from "alepha/react/auth";
import { ReactBootHealth, ReactBrowserProvider } from "alepha/react/router";
import { currentUserAtom } from "alepha/security";
import { HttpClient, HttpError } from "alepha/server";
import type { Tokens } from "alepha/server/auth";
import { LinkProvider } from "alepha/server/links";

import { NativeSession } from "../services/NativeSession.ts";
import { CapacitorConfigProvider } from "./CapacitorConfigProvider.ts";

/**
 * `ReactAuth`'s transport inside a native shell: password sign-in against
 * the API's origin, the session in secure storage, a Bearer header instead of
 * cookies.
 *
 * - Every auth request goes to the shell's `apiUrl` with `credentials:
 *   "omit"`: a cookie of the API's origin would never reach a WebView on
 *   `capacitor://localhost`, and asking for one needs a CORS grant a Bearer
 *   API does not give.
 * - Every host-less `$client` call to the API carries the session's Bearer
 *   (`LinkProvider.setDefaultAuthorization`), and nothing else does: a
 *   client naming another hostname never receives it.
 * - At boot, a stored session is restored and validated through `userinfo`
 *   before the first page decides anything, inside the router's boot
 *   deadline. No response keeps the session and ends on the offline screen; a
 *   refused one clears it.
 * - Sign-out revokes the session on the server (`deleteMySession`), then
 *   forgets it locally whether or not the server answered, and says which.
 *
 * Installed by `AlephaCapacitor` in a native shell.
 */
export class NativeAuthTransport extends ReactAuthTransport {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly http = $inject(HttpClient);
  protected readonly links = $inject(LinkProvider);
  protected readonly session = $inject(NativeSession);
  protected readonly config = $inject(CapacitorConfigProvider);
  protected readonly bootHealth = $inject(ReactBootHealth);

  public override readonly cookies = false;

  protected readonly onConfigure = $hook({
    on: "configure",
    handler: () => {
      this.links.setDefaultAuthorization(async () => {
        const token = await this.session.accessToken();
        return token ? `Bearer ${token}` : undefined;
      });
      this.bootHealth.addBootTask(() => this.restore());
    },
  });

  public override url(path: string): string {
    return `${this.config.get()?.apiUrl ?? ""}${path}`;
  }

  public override async request(opts: { authenticated: boolean }): Promise<{
    headers?: Record<string, string>;
    credentials?: RequestCredentials;
  }> {
    const token = opts.authenticated
      ? await this.session.accessToken()
      : undefined;
    return {
      credentials: "omit",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    };
  }

  public override async signedIn(tokens: Tokens): Promise<void> {
    await this.session.save(tokens);
  }

  /**
   * Bring back the stored session, validated by the server. Run as a boot
   * task, inside the first transition's deadline.
   */
  public async restore(): Promise<void> {
    if (!(await this.session.load())) {
      return;
    }

    const auth = this.alepha.inject(ReactAuth);
    try {
      await auth.ping();
      return;
    } catch (error) {
      if (this.bootHealth.isNetworkError(error)) {
        // Offline, not signed out: the session stays for the retry.
        throw error;
      }
      if (!(error instanceof HttpError) || error.status !== 401) {
        this.log.warn("Could not validate the stored session", error);
        return;
      }
    }

    // The access token was refused: refresh once, then ask again. A refused
    // refresh clears the session (NativeSession), and the app boots signed
    // out.
    try {
      await this.session.refresh();
      await auth.ping();
    } catch (error) {
      if (this.bootHealth.isNetworkError(error)) {
        throw error;
      }
      this.log.info("The stored session is no longer valid");
    }
  }

  /**
   * Revoke the session on the server, then forget it here.
   *
   * Local state is cleared even when the server cannot be reached, so the
   * phone is signed out either way; `capacitor:auth:signout` says whether the
   * server confirmed the revocation. An access token already issued stays
   * valid until it expires, as on the web: what revocation stops is the next
   * refresh.
   */
  public override async signOut(): Promise<boolean> {
    const revoked = await this.revoke();

    await this.session.clear();
    this.alepha.store.set(currentUserAtom, undefined);
    try {
      await this.links.fetchLinks();
    } catch (error) {
      this.log.debug("Could not reload the anonymous action registry", error);
    }

    await this.alepha.events.emit("capacitor:auth:signout", { revoked });
    if (!revoked) {
      this.log.warn(
        "Signed out on this device; the server did not confirm the session was revoked",
      );
    }

    if (this.alepha.isBrowser()) {
      await this.alepha
        .inject(ReactBrowserProvider)
        .push("/", { replace: true });
    }
    return true;
  }

  /**
   * `DELETE` the current session through the API's own `deleteMySession`
   * action, addressed from the registry the API published. False when it
   * could not be confirmed.
   */
  protected async revoke(): Promise<boolean> {
    const user = this.alepha.store.get(currentUserAtom);
    const registry = this.alepha.store.get("alepha.server.request.apiLinks");
    const action = registry?.actions?.deleteMySession;
    if (!user?.sessionId || !action || !this.session.hasSession()) {
      return false;
    }

    try {
      const token = await this.session.accessToken();
      const path = action.path.replace(
        ":id",
        encodeURIComponent(user.sessionId),
      );
      await this.http.fetch(
        `${this.config.get()?.apiUrl ?? ""}${registry.prefix ?? "/api"}${path}`,
        {
          method: "DELETE",
          credentials: "omit",
          headers: token ? { authorization: `Bearer ${token}` } : {},
        },
      );
      return true;
    } catch (error) {
      this.log.warn("Session revocation failed", error);
      return false;
    }
  }
}
