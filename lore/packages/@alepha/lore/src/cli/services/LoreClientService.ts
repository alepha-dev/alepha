import { $env, $inject, AlephaError, z } from "alepha";
import { CommandError } from "alepha/command";
import { HttpClient, HttpError } from "alepha/server";
import type { ClientScope } from "alepha/server/links";

import { LoreTokenStore } from "./LoreTokenStore.ts";

/**
 * The one place that answers "where is Lore, and how do I authenticate to it".
 *
 * Every `lore <cmd>` builds its client from {@link scope}, so the OAuth
 * 2.0 device flow later replaces the `authorization` thunk and nothing else.
 * That containment is the whole reason this is a service rather than a header
 * inlined into whichever command needed one first.
 */
export class LoreClientService {
  /**
   * Where an app reports when it names no other, matching `SIGIL_SINK`'s own
   * default. A commons that is there if you want it and one variable away if
   * you do not.
   */
  public static readonly DEFAULT_HOSTNAME = "https://lore.alepha.dev";

  /**
   * The OAuth client `lore login` signs in as, and so the one its refresh must
   * name: the server binds a session to the client that created it and
   * refuses a refresh under any other.
   */
  public static readonly CLIENT_ID = "alepha-cli";

  protected readonly tokens = $inject(LoreTokenStore);
  protected readonly http = $inject(HttpClient);

  /**
   * The origin a caller configured in code, below `LORE_URL`: what
   * `lore({ url })` in `alepha.config.ts` sets. See {@link useUrl}.
   */
  protected configuredUrl?: string;

  /**
   * The refresh in flight, per hostname. The credential is resolved per
   * request, so a command sending several at once would otherwise trade the
   * same expired token several times over.
   */
  protected readonly refreshing = new Map<
    string,
    Promise<string | undefined>
  >();

  protected readonly env = $env(
    z.object({
      LORE_API_KEY: z.text({
        default: "",
        description:
          "API key for the Lore instance, from the account's API keys page. Secret.",
      }),
      // ⚠️ Empty by default, not the public origin: an explicit `LORE_URL`
      // must be told apart from an absent one, since it wins over a URL set in
      // code (`lore({ url })`) and an absent one does not.
      LORE_URL: z.text({
        default: "",
        secret: false,
        description:
          "Origin of the Lore instance. Defaults to the public one (https://lore.alepha.dev); set it to self-host.",
      }),
      LORE_PROJECT: z.text({
        default: "",
        secret: false,
        description:
          "Default Lore project slug, overridden by --project. A workflow sets it once instead of every step passing a flag.",
      }),
      LORE_APP: z.text({
        default: "",
        secret: false,
        description:
          "Default app name for the `lore apps` commands, overridden by --app. Falls back to the slugified `name` in package.json.",
      }),
      LORE_ENV: z.text({
        default: "",
        secret: false,
        description:
          "Default environment for the `lore` deploy commands, overridden by --env. Falls back to the app's own environments, read from Lore, when it has exactly one.",
      }),
    }),
  );

  /**
   * The scope every `$client<SomeController>()` in this package is built from.
   *
   * ⚠️ The credential is a **thunk**, resolved per request rather than here.
   * Two reasons, and the second is why it matters today: a device-flow token
   * refreshes, so a long-running process that pinned the first value would
   * work for fifteen minutes and then fail for good; and a command has to be
   * constructible on a machine with no credential at all, or `--help` would
   * fail on the very machine someone is reading it on.
   */
  public scope(): ClientScope {
    const scope: ClientScope = {
      authorization: () => this.authorization(),
    };
    // A getter, read per request like the credential: a `$client` is built in
    // a field initializer, before `lore({ url })` can call `useUrl`. The link
    // provider spreads the scope on every call, which reads it then.
    Object.defineProperty(scope, "hostname", {
      get: () => this.hostname(),
      enumerable: true,
    });
    return scope;
  }

  /**
   * Point this process at an origin configured in code.
   *
   * `LORE_URL` still wins, so CI and a self-hoster's shell need no edit to a
   * committed config. `undefined` clears it.
   */
  public useUrl(url: string | undefined): void {
    this.configuredUrl = url || undefined;
  }

  /**
   * Where this invocation is talking to.
   *
   * Public because one caller cannot use a `ClientScope`: `ArtifactUploader`
   * composes its own request, since the typed client would materialise the
   * whole tarball to send it. Both still come through here, which is what
   * keeps "where is Lore" one answer rather than two.
   *
   * `||`, not `??`. A schema default only fills an ABSENT variable, and
   * `LORE_URL=` in a `.env` file or a CI environment is present and empty -
   * which would otherwise resolve to an empty hostname and send the request
   * nowhere, with nothing saying why. Empty reads as "unset", which is how
   * {@link authorization} already reads an empty key.
   */
  public hostname(): string {
    return String(
      this.env.LORE_URL ||
        this.configuredUrl ||
        LoreClientService.DEFAULT_HOSTNAME,
    );
  }

  /**
   * The `Authorization` header value, resolved now.
   *
   * Never cached by a caller: see {@link scope} for why the credential is a
   * thunk everywhere it is used.
   *
   * ## ⚠️ The order is load-bearing, not cosmetic
   *
   * 1. `LORE_API_KEY`, which is what CI has.
   * 2. A device-flow token cached for this hostname, which is what a laptop
   *    has after `lore login`. Refreshed first when it has expired: see
   *    {@link refresh}.
   * 3. An error naming both fixes.
   *
   * **Nothing here ever starts a login.** There is no human in CI to approve a
   * device code, so a runner that fell into that flow would poll until it
   * timed out - a job that hangs and then fails for a reason its log does not
   * explain. A missing credential is a fast, legible error instead, and
   * `lore login` refuses to run in CI at all.
   *
   * The key wins over the cached token deliberately. A machine that has both
   * is a developer's laptop with a key exported for a one-off, and the
   * explicit thing they just typed should be the one that is used.
   */
  public async authorization(): Promise<string> {
    const key = String(this.env.LORE_API_KEY ?? "");
    if (key) {
      return `Bearer ${key}`;
    }

    const hostname = this.hostname();
    const token =
      (await this.tokens.read(hostname)) ?? (await this.refresh(hostname));
    if (token) {
      return `Bearer ${token}`;
    }

    // A `CommandError` carrying exit code 3, so the CLI reports it as a
    // refusal rather than a crash, and a script can tell "not authenticated"
    // from any other failure without reading the sentence.
    throw new CommandError(
      `Not authenticated to ${hostname}. Run \`lore login\` on a machine with a browser, or set LORE_API_KEY (which is what CI does).`,
      { exitCode: 3 },
    );
  }

  /**
   * Trade this hostname's expired login for a fresh access token, or answer
   * `undefined` when there is nothing to trade.
   *
   * Lore's access tokens last fifteen minutes and its refresh tokens up to 180
   * days, or 30 without use. The refresh token was stored from the start and
   * never sent, so a `lore login` lasted fifteen minutes (#Q2387).
   *
   * ⚠️ Only a REFUSAL forgets the login. A 400 or 401 means the session is
   * gone (revoked, idle past its window), and keeping the entry would retry a
   * dead token on every command. Anything else, Lore unreachable or a 5xx, is
   * thrown as it is and the entry kept: an outage must not cost the laptop its
   * login.
   */
  protected refresh(hostname: string): Promise<string | undefined> {
    const inFlight = this.refreshing.get(hostname);
    if (inFlight) {
      return inFlight;
    }
    const pending = this.exchange(hostname).finally(() =>
      this.refreshing.delete(hostname),
    );
    this.refreshing.set(hostname, pending);
    return pending;
  }

  /**
   * The `refresh_token` grant itself, form-encoded as RFC 6749 §6 specifies
   * and as `lore login` sends its own grant.
   */
  protected async exchange(hostname: string): Promise<string | undefined> {
    const entry = await this.tokens.entry(hostname);
    if (!entry?.refreshToken) {
      return undefined;
    }

    try {
      const res = await this.http.fetch(`${hostname}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: entry.refreshToken,
          client_id: LoreClientService.CLIENT_ID,
        }).toString(),
      });
      const grant = (res.data ?? {}) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };
      if (!grant.access_token) {
        throw new AlephaError(
          `${hostname} answered a token refresh without an access token.`,
        );
      }

      await this.tokens.write(
        hostname,
        this.tokens.fromGrant(
          { ...grant, access_token: grant.access_token },
          entry.refreshToken,
        ),
      );
      return grant.access_token;
    } catch (error) {
      if (
        HttpError.is(error) &&
        (error.status === 400 || error.status === 401)
      ) {
        await this.tokens.clear(hostname);
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Which project this invocation is about.
   *
   * `--project` beats `LORE_PROJECT`, so a workflow names the destination once
   * and a single step can still send its build somewhere else.
   *
   * `||`, not `??`, for the reason {@link hostname} already carries: a schema
   * default only fills an ABSENT variable, and `LORE_PROJECT=` in a `.env`
   * file or a CI environment is present and empty. With `??` that resolves to
   * an empty slug, and the request goes to a URL with a hole in it rather than
   * to the error below.
   *
   * ⚠️ The throw is the thing to get right here, not the lookup. A push with
   * no project is exactly what cost Lore its own 0.28.0 artifact: this method
   * threw, the step was `continue-on-error`, and the release went green with a
   * warning annotation nobody read.
   */
  public resolveProject(flag?: string): string {
    const project = flag || String(this.env.LORE_PROJECT || "");
    if (!project) {
      throw new AlephaError(
        "No Lore project named. Pass --project <slug> (or -p), or set LORE_PROJECT in the environment.",
      );
    }
    return project;
  }

  /**
   * The app named by a flag or the environment, or nothing.
   *
   * ⚠️ Returns `undefined` rather than throwing, unlike {@link resolveProject},
   * because this axis has a third step the environment cannot reach: the
   * directory's own `package.json` name. `LoreProjectResolver.resolveApp` is
   * what walks the whole chain and produces the error, since it is the one that
   * can read a file.
   *
   * `||` not `??`, for the reason {@link hostname} carries.
   */
  /**
   * The project `LORE_PROJECT` names, or nothing: for a caller whose own
   * setting it overrides, the reverse of {@link resolveProject}'s precedence.
   */
  public projectFromEnv(): string | undefined {
    return String(this.env.LORE_PROJECT || "") || undefined;
  }

  public appFromEnv(flag?: string): string | undefined {
    return flag || String(this.env.LORE_APP || "") || undefined;
  }

  /**
   * The environment named by a flag or the environment, or nothing.
   *
   * ⚠️ Also `undefined` rather than a throw, and here the third step is a
   * REMOTE read: the app's own rows, in {@link LoreProjectResolver.resolveEnv}.
   * `production` as a client-side constant was wrong the moment environments
   * became rows - a project may run `b14-production` and have no `production`
   * at all - so the fallback cannot live in this file.
   *
   * `||` not `??`, same rule.
   */
  public envFromEnv(flag?: string): string | undefined {
    return flag || String(this.env.LORE_ENV || "") || undefined;
  }
}

/*
  ⚠️ `.lorerc.json` is future work, and will NOT be an epic #27 regression.

  Worth writing down here, beside the variables it would supplement, so a later
  session does not read it as one. Epic #27 removed a `lore()` plugin
  registration from `alepha.config.ts`, which dragged the app's entire
  container, build options and config into the CLI's process. A small standalone
  `.lorerc.json` (`{ url, project, app }`) read by the `lore` binary alone is a
  different and far cheaper thing: no container, no Vite, no app code.

  Environment variables first is the correct order. File the config file
  separately once this shape has been used in anger.
*/
