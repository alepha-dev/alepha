import { $env, $inject, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { HttpClient, HttpError } from "alepha/server";

import { LoreClientService } from "../services/LoreClientService.ts";
import { type LoreToken, LoreTokenStore } from "../services/LoreTokenStore.ts";

/**
 * `alepha lore login` and `alepha lore logout` - the OAuth 2.0 device flow
 * (RFC 8628), so a laptop can talk to Lore without pasting a token into a
 * shell.
 *
 * ## The server half already existed
 *
 * `alepha/api/oauth` implements `POST /oauth/device_authorization` and the
 * `urn:ietf:params:oauth:grant-type:device_code` grant, with tests. Lore is
 * already an authorization server that can do this; nothing was added there.
 *
 * ## ⚠️ This is NOT the CI path, and the difference is load-bearing
 *
 * There is no human in CI to approve a code, so a runner that fell into this
 * flow would poll until it timed out - a job that hangs for fifteen minutes
 * and then fails for a reason its log does not explain. Two things prevent it,
 * and neither is a convention:
 *
 * - {@link LoreClientService.authorization} never STARTS a flow. A missing
 *   credential is an error naming both fixes, not a login prompt.
 * - `login` refuses to run in CI outright. It is only reachable by someone
 *   typing it, and in CI nobody is typing.
 *
 * ## ⚠️ NOT re-exported from `index.ts`
 *
 * Same rule as the other commands: it is registered as a service and reached
 * through `LoreCommand`, never named in a published signature.
 */
export class LoginCommand {
  protected readonly log = $logger();
  protected readonly client = $inject(LoreClientService);
  protected readonly tokens = $inject(LoreTokenStore);
  protected readonly http = $inject(HttpClient);
  protected readonly dateTime = $inject(DateTimeProvider);

  protected readonly env = $env(
    z.object({
      /**
       * Set by every CI system worth the name, and by GitHub Actions in
       * particular. Read through `$env` rather than `process.env`, so the one
       * refusal that only ever happens on a runner is reachable from a test.
       */
      CI: z.text({ default: "", secret: false }).optional(),
    }),
  );

  /**
   * How long to keep polling before giving up, if the grant names no lifetime.
   * RFC 8628's own default is 1800s; this is shorter because a person is
   * watching it.
   */
  protected static readonly DEFAULT_EXPIRY_SECONDS = 600;

  /**
   * The poll interval when the grant names none. RFC 8628 §3.5: "If no value
   * is provided, clients MUST use 5 as the default."
   */
  protected static readonly DEFAULT_INTERVAL_SECONDS = 5;

  /**
   * The floor under whatever the server asks for.
   *
   * ⚠️ Deliberately 1 and not 5. The interval is the SERVER's to choose - the
   * RFC's 5 is a default for when it names none, not a minimum - so clamping
   * everything to 5 would ignore an instance that knows it can answer faster.
   * The floor exists only so a server answering `0` cannot turn the loop into
   * a spin, which `expires_in` alone would bound at ten minutes of it.
   */
  protected static readonly MIN_INTERVAL_SECONDS = 1;

  public readonly login = $command({
    name: "login",
    description: "Sign in to a Lore instance from this machine",
    handler: async () => {
      if (this.env.CI) {
        throw new AlephaError(
          "`alepha lore login` needs a human to approve a code, and CI has none. Set LORE_API_KEY in the job's environment instead.",
        );
      }

      const hostname = this.client.hostname();
      const start = await this.request<DeviceAuthorization>(
        `${hostname}/oauth/device_authorization`,
        { client_id: "alepha-cli", scope: "mcp" },
      );

      // Printed before the wait, and both forms of it: RFC 8628 §3.3.1 wants
      // the plain URI for whoever cannot follow a link, and the pre-filled one
      // for whoever can.
      this.log.info(`Open ${start.verification_uri} and enter this code:`);
      this.log.info(`  ${start.user_code}`);
      if (start.verification_uri_complete) {
        this.log.info(`Or open ${start.verification_uri_complete}`);
      }

      const token = await this.poll(hostname, start);
      await this.tokens.write(hostname, token);

      this.log.info(`Signed in to ${hostname}.`);
    },
  });

  public readonly logout = $command({
    name: "logout",
    description: "Forget this machine's login for a Lore instance",
    handler: async () => {
      const hostname = this.client.hostname();
      const had = await this.tokens.clear(hostname);

      // "Nothing to forget" is said out loud rather than reported as a
      // success: a logout that quietly does nothing leaves someone believing
      // they revoked a credential they are still carrying, on some other
      // hostname.
      this.log.info(
        had
          ? `Forgot the login for ${hostname}.`
          : `No login stored for ${hostname}. Nothing to forget.`,
      );
    },
  });

  /**
   * Wait for the human, then take the token.
   *
   * Every branch here is one of RFC 8628 §3.5's named errors, and a device is
   * expected to act differently on each: keep waiting, back off, give up, or
   * report a refusal. Collapsing them would make the difference between "the
   * user has not clicked yet" and "the user said no" invisible, and the second
   * should not cost ten more minutes of polling.
   */
  protected async poll(
    hostname: string,
    start: DeviceAuthorization,
  ): Promise<LoreToken> {
    let interval = Math.max(
      start.interval ?? LoginCommand.DEFAULT_INTERVAL_SECONDS,
      LoginCommand.MIN_INTERVAL_SECONDS,
    );
    const deadline =
      this.dateTime.nowMillis() +
      (start.expires_in ?? LoginCommand.DEFAULT_EXPIRY_SECONDS) * 1000;

    while (this.dateTime.nowMillis() < deadline) {
      // Through the provider, never a bare `setTimeout`: it is the seam that
      // makes the clock controllable, and a loop that sleeps behind its back
      // is a loop no test can drive.
      await this.dateTime.wait([interval, "seconds"]);

      const res = await this.request<DeviceTokenResponse>(
        `${hostname}/oauth/token`,
        {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: start.device_code,
          client_id: "alepha-cli",
        },
        // A pending grant answers 400 by design, so it is not an error the
        // client may throw on.
        { allowError: true },
      );

      if (res.access_token) {
        return {
          accessToken: res.access_token,
          refreshToken: res.refresh_token,
          // Stamped from the provider, never `Date.now()`: an expiry the
          // clock decides is an expiry no test can pin.
          expiresAt: res.expires_in
            ? this.dateTime.now().add(res.expires_in, "seconds").toISOString()
            : undefined,
        };
      }

      if (res.error === "slow_down") {
        interval += 5;
        continue;
      }
      if (res.error === "authorization_pending") {
        continue;
      }
      if (res.error === "access_denied") {
        throw new AlephaError("The sign-in was refused in the browser.");
      }
      if (res.error === "expired_token") {
        break;
      }
      throw new AlephaError(
        `Unexpected answer from ${hostname}: ${res.error ?? "no token and no error"}.`,
      );
    }

    throw new AlephaError(
      "The code expired before it was approved. Run `alepha lore login` again.",
    );
  }

  /**
   * A form-encoded POST, which is what RFC 6749 §4 specifies for these two
   * endpoints and what every other OAuth client sends them.
   *
   * ## ⚠️ A pending grant is a 400, and 400 is not an error here
   *
   * RFC 8628 §3.5 answers "the user has not approved yet" with
   * `400 {"error":"authorization_pending"}`, so the ordinary poll is a status
   * `HttpClient` throws on. `allowError` catches that and hands the code back
   * as data.
   *
   * It reads the code off `HttpError.message`, which is exact rather than
   * lucky: `HttpClient.responseError` tries the framework's own error schema
   * first, an OAuth body carries neither `status` nor `message`, so the
   * fallback puts `json.error` there verbatim. Worth knowing if that fallback
   * ever changes - the four branches in {@link poll} are what would go quiet.
   */
  protected async request<T>(
    url: string,
    fields: Record<string, string>,
    options: { allowError?: boolean } = {},
  ): Promise<T> {
    try {
      const res = await this.http.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      });
      return (res.data ?? {}) as T;
    } catch (error) {
      if (!options.allowError || !HttpError.is(error)) {
        throw error;
      }
      return { error: error.message } as T;
    }
  }

  /**
   * Sleeping, in one place, so the poll loop reads as a loop.
   */
  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * RFC 8628 §3.2.
 */
interface DeviceAuthorization {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
}

/**
 * RFC 8628 §3.5: either a token or one of four named errors.
 */
interface DeviceTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}
