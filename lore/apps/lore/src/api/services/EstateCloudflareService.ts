import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { type Estate, estates } from "../entities/estates.ts";
import { CloudflareProbeService } from "./CloudflareProbeService.ts";
import { CredentialSealService } from "./CredentialSealService.ts";

/**
 * Which field on the create form a failure belongs beside.
 *
 * Carried on the error's `data` so the dialog (#1865) can render the message
 * against the account id or the token rather than as a toast the person is
 * left to interpret. A wrong account id and a missing permission are not the
 * same mistake and are not fixed in the same field.
 */
export type EstateCredentialField = "accountId" | "token";

/**
 * What Lore knows about a Cloudflare credential after asking Cloudflare.
 *
 * Three answers, not two. **A transport failure is no verdict**: a network
 * error, a timeout, a `5xx` or a `429` means Lore does not know, and "does
 * not know" must never be written to a row as "invalid", or a Cloudflare
 * outage at midnight would flip every estate at once and email every owner.
 */
export type EstateCredentialCheck =
  | { outcome: "passed"; expiresAt?: string }
  | { outcome: "failed"; message: string; field: EstateCredentialField }
  | { outcome: "inconclusive"; message: string };

/**
 * One permission group, and the cheap `GET` that proves a token carries it.
 */
export interface CloudflarePermissionProbe {
  key: string;
  /**
   * Appended to `/accounts/{id}`. Empty for the account probe itself.
   */
  path: string;
  /**
   * Cloudflare's own wording for the permission, in the spelling the
   * **dashboard** uses. Its API permission-group names say `Write` where the
   * dashboard says `Edit`; the reader is looking at the dashboard.
   */
  permission: string;
}

/**
 * Everything Lore does with a Cloudflare estate's credential: mask it, prove
 * it against the account it names, and record what the proof said.
 *
 * ## Cloudflare never names the missing permission, so the probe does
 *
 * A call a token may not make answers `403` with error `10000`,
 * "Authentication error", and that is the same code for every missing
 * permission. There is no endpoint a token can call to read its own policies
 * without "API Tokens: Read", which a deploy token will not carry. So the
 * permission is named by the probe that failed: one cheap `GET` per group,
 * and the failing group is the message.
 *
 * ## Every probe is required
 *
 * The owner's ruling of 2026-09-05. The set is what a Lore deploy needs
 * across the apps Lore may deploy, so a token is either fit for the estate
 * or it is not, and epic #1's gate has one question to ask,
 * `credentialStatus === "valid"`, rather than a capability matrix. A read
 * passing does not prove Edit, and nothing can prove Edit short of writing;
 * the message says "Edit" and the guide names the template.
 *
 * ⚠️ {@link PERMISSION_PROBES} is a **contract** with #1517 and with the
 * guide at `/lore/docs/guides-cloudflare-token`. When #1517 learns what a
 * Lore deploy really calls, this table, the spec that pins it and that page
 * all change together. `yarn check:docs` cannot see that drift.
 *
 * ⚠️ **The token is an argument, never an environment variable.** It lives
 * as a sealed column, is opened at the moment of use and passed in. There is
 * no `CLOUDFLARE_API_TOKEN` and no import from `alepha/cli/platform-lib`;
 * see `CloudflareProbeService` for why that client in particular cannot be
 * the one.
 */
export class EstateCloudflareService {
  /**
   * How much of a pasted token {@link mask} keeps.
   *
   * The kind marker plus eight characters, which is the bay rule
   * (`EstateTokenService.PREFIX_LENGTH` is `est_` plus eight) applied to a
   * credential Lore did not mint. Eight AFTER the marker and not eight in
   * total: `cfut_` is five characters, so a total of eight would show three
   * characters of the token and name nothing.
   */
  public static readonly MASK_LENGTH_AFTER_MARKER = 8;

  /**
   * The marker of an account-owned token, which verifies through the
   * account's own endpoint rather than the user's.
   */
  public static readonly ACCOUNT_TOKEN_MARKER = "cfat_";

  /**
   * The marker of a user token. A legacy token is 40 characters with no
   * marker at all and verifies the same way this one does.
   */
  public static readonly USER_TOKEN_MARKER = "cfut_";

  /**
   * Six groups, seven `GET`s with the identity probe. Nothing is cached: a
   * save is rare and the answer has to be current.
   *
   * ⚠️ There is **no workers.dev subdomain probe**. It proved the same group
   * as `workers`, and `GET /accounts/{id}/workers/subdomain` answers error
   * `10007` for an account that never registered one, which a permission
   * probe would misread and use to refuse a perfectly valid token.
   *
   * ⚠️ There is **no zone probe**. Every app Lore deploys uses a plain
   * custom domain, which `BuildCloudflareTask.enhanceDomain` emits as
   * `custom_domain: true` and Cloudflare serves from
   * `PUT /accounts/{id}/workers/domains` under "Workers Scripts: Edit": the
   * `workers` probe already proves it. Wildcard hosts go away when Alepha
   * Club goes mono-tenant after epic #1 (owner's ruling, 2026-09-06).
   */
  public static readonly PERMISSION_PROBES: readonly CloudflarePermissionProbe[] =
    [
      { key: "account", path: "", permission: "Account Settings: Read" },
      {
        key: "workers",
        path: "/workers/scripts",
        permission: "Workers Scripts: Edit",
      },
      { key: "d1", path: "/d1/database", permission: "D1: Edit" },
      {
        key: "kv",
        path: "/storage/kv/namespaces",
        permission: "Workers KV Storage: Edit",
      },
      {
        key: "r2",
        path: "/r2/buckets",
        permission: "Workers R2 Storage: Edit",
      },
      { key: "queues", path: "/queues", permission: "Queues: Edit" },
    ];

  /**
   * What the three callers say when Cloudflare could not be reached. One
   * sentence, so the form, the drawer and the log agree.
   */
  public static readonly UNREACHABLE =
    "Cloudflare could not be reached, try again";

  protected readonly estates = $repository(estates);
  protected readonly probes = $inject(CloudflareProbeService);
  protected readonly seal = $inject(CredentialSealService);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The first characters of a token, enough for a person to tell two apart
   * and far too few to reconstruct one.
   */
  mask(token: string): string {
    const marker = [
      EstateCloudflareService.USER_TOKEN_MARKER,
      EstateCloudflareService.ACCOUNT_TOKEN_MARKER,
    ].find((it) => token.startsWith(it));
    const kept =
      (marker?.length ?? 0) + EstateCloudflareService.MASK_LENGTH_AFTER_MARKER;
    return token.slice(0, kept);
  }

  /**
   * Proves a token against the account it names: identity first, then one
   * probe per permission group.
   *
   * Called before the row is written on a create, before the column changes
   * on a replace, on demand from the owner's drawer, and every night by
   * {@link recheck}.
   */
  async check(input: {
    accountId: string;
    token: string;
  }): Promise<EstateCredentialCheck> {
    const identity = await this.checkIdentity(input);
    if (identity.outcome !== "passed") {
      return identity;
    }

    for (const probe of EstateCloudflareService.PERMISSION_PROBES) {
      const answer = await this.probes.get(
        `/accounts/${input.accountId}${probe.path}`,
        input.token,
      );
      if (answer.ok) {
        continue;
      }
      if (this.isTransportFailure(answer.status)) {
        return {
          outcome: "inconclusive",
          message: EstateCloudflareService.UNREACHABLE,
        };
      }
      // The account probe fails two ways that look identical on the wire,
      // and the wrong-account one is the more confusing of the two, so the
      // sentence names both and the dialog puts it beside the account id.
      if (probe.key === "account") {
        return {
          outcome: "failed",
          field: "accountId",
          message: `Lore could not read Cloudflare account ${input.accountId} with this token. Either the account id is wrong, or the token is missing "Account Settings: Read".`,
        };
      }
      return {
        outcome: "failed",
        field: "token",
        message: `This token cannot reach ${probe.key === "workers" ? "Workers" : probe.key.toUpperCase()} on this account. Add "${probe.permission}" to it and try again.`,
      };
    }

    return { outcome: "passed", expiresAt: identity.expiresAt };
  }

  /**
   * Re-runs every probe for one estate and records the outcome on the row.
   *
   * The three callers are the drawer's "Check again", the nightly sweep, and
   * nothing else: creation and replacement check BEFORE they write, so they
   * call {@link check} rather than this.
   *
   * ⚠️ An inconclusive answer leaves the row exactly as it was. That is what
   * keeps a Cloudflare outage from flipping every estate in the instance at
   * midnight and emailing every owner about it.
   */
  async recheck(estate: Estate): Promise<EstateCredentialCheck> {
    if (estate.type !== "cloudflare") {
      return {
        outcome: "failed",
        field: "token",
        message: "Only a cloudflare estate has a token to check",
      };
    }
    if (!estate.credential || !estate.accountId) {
      return {
        outcome: "failed",
        field: "token",
        message: "This estate has no Cloudflare credential to check",
      };
    }

    const token = this.seal.open(
      estate.credential,
      CredentialSealService.ESTATE_PURPOSE,
    );
    const check = await this.check({ accountId: estate.accountId, token });
    if (check.outcome === "inconclusive") {
      return check;
    }

    await this.estates.updateById(estate.id, {
      credentialCheckedAt: this.dateTime.now().toISOString(),
      credentialError: check.outcome === "failed" ? check.message : null,
      credentialExpiresAt:
        check.outcome === "passed" ? (check.expiresAt ?? null) : null,
    });
    return check;
  }

  /**
   * Whether this row's credential currently counts as usable.
   *
   * Two values and no `unknown`: a cloudflare estate cannot exist without a
   * passed check (#1629), so there is no state between them to name. The
   * expiry is applied HERE rather than by the sweep, so a token that expires
   * at noon reads invalid at noon instead of at the next midnight.
   */
  credentialStatus(
    estate: Estate,
    now = this.dateTime.nowMillis(),
  ): "valid" | "invalid" | undefined {
    if (estate.type !== "cloudflare") {
      return undefined;
    }
    if (estate.credentialError) {
      return "invalid";
    }
    if (
      estate.credentialExpiresAt &&
      Date.parse(estate.credentialExpiresAt) <= now
    ) {
      return "invalid";
    }
    return "valid";
  }

  /**
   * Token validity and expiry, through the endpoint that matches the kind.
   *
   * A `cfat_` token is account-owned and verifies through the account's
   * endpoint; a `cfut_` or legacy token verifies through the user's. Three
   * failures with three sentences, none of which is a missing permission:
   * expired, disabled (revoked or switched off at Cloudflare), and a
   * `not_before` still in the future.
   */
  protected async checkIdentity(input: {
    accountId: string;
    token: string;
  }): Promise<EstateCredentialCheck> {
    const path = input.token.startsWith(
      EstateCloudflareService.ACCOUNT_TOKEN_MARKER,
    )
      ? `/accounts/${input.accountId}/tokens/verify`
      : "/user/tokens/verify";

    const answer = await this.probes.get(path, input.token);
    if (this.isTransportFailure(answer.status)) {
      return {
        outcome: "inconclusive",
        message: EstateCloudflareService.UNREACHABLE,
      };
    }
    if (!answer.ok) {
      return {
        outcome: "failed",
        field: "token",
        message: "Cloudflare did not accept this token",
      };
    }

    const status = answer.result?.status;
    if (status === "expired") {
      return {
        outcome: "failed",
        field: "token",
        message: "This Cloudflare token has expired",
      };
    }
    if (status && status !== "active") {
      return {
        outcome: "failed",
        field: "token",
        message:
          "This Cloudflare token is disabled; enable it at Cloudflare or mint a new one",
      };
    }

    const notBefore = answer.result?.not_before;
    if (notBefore && Date.parse(notBefore) > this.dateTime.nowMillis()) {
      return {
        outcome: "failed",
        field: "token",
        message: `This Cloudflare token is not valid before ${notBefore}`,
      };
    }

    return {
      outcome: "passed",
      expiresAt: answer.result?.expires_on ?? undefined,
    };
  }

  /**
   * Whether an answer means "Lore could not ask" rather than "Cloudflare
   * said no".
   *
   * `0` is a network error or a timeout; a `429` is Cloudflare asking to be
   * asked later; a `5xx` is Cloudflare failing. None of the three is
   * evidence about the token, and treating any of them as one is how an
   * outage becomes a fleet of invalid estates.
   */
  protected isTransportFailure(status: number): boolean {
    return status === 0 || status === 429 || status >= 500;
  }
}
