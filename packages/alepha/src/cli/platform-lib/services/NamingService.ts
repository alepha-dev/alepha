import { AlephaError } from "alepha";

/**
 * Multi-tenancy mode for an app's deployments.
 *
 * - `none` (default): single-instance app. Passing `--tenant` is an
 *   error — guards a non-tenanted app (e.g. the SaaS console) from
 *   accidentally getting a tenant prefix.
 * - `required`: every deploy targets a tenant. Omitting `--tenant` is an
 *   error — kills the "forgot the flag → deployed to the apex" footgun.
 * - `optional`: both work — a base instance (no `--tenant`) and per-tenant
 *   instances coexist (distinct names + hosts).
 */
export type Tenancy = "none" | "optional" | "required";

/**
 * Validate a `--tenant` value against the app's declared `tenancy` and
 * return the effective tenant (or `undefined` for a base/non-tenanted
 * deploy). Throws on any matrix violation so a misconfigured deploy fails
 * fast instead of landing on the wrong resource names / host.
 */
export function resolveTenant(
  tenancy: Tenancy | undefined,
  tenant: string | undefined,
): string | undefined {
  const mode = tenancy ?? "none";

  if (tenant !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(tenant)) {
    throw new AlephaError(
      `Invalid --tenant "${tenant}": must be a slug (lowercase alphanumeric + dashes, e.g. "b14").`,
    );
  }

  if (mode === "none") {
    if (tenant !== undefined) {
      throw new AlephaError(
        `This app is not tenanted (tenancy: "none") but --tenant "${tenant}" was given. ` +
          `Set tenancy: "optional" | "required" in platform() to deploy per-tenant.`,
      );
    }
    return undefined;
  }

  if (mode === "required" && tenant === undefined) {
    throw new AlephaError(
      `This app requires a tenant (tenancy: "required"). Pass --tenant <slug>.`,
    );
  }

  // required+value or optional(+/- value) — value may be undefined for the
  // optional base instance.
  return tenant;
}

/**
 * Resolve the host a deploy is served on.
 *
 * - `override` (V2 custom domains, e.g. `reservation.club-b14.fr`) wins
 *   outright when supplied — not wired to a flag today, but the single
 *   seam a future `--domain` / Rocket `config.hostname` plugs into.
 * - else a tenant becomes the leftmost DNS label: `b14` + `alepha.club`
 *   → `b14.alepha.club`.
 * - else the base domain is used as-is.
 */
export function tenantDomain(
  base: string | undefined,
  tenant: string | undefined,
  override?: string,
): string | undefined {
  if (override) return override;
  if (!base) return base;
  return tenant ? `${tenant}.${base}` : base;
}

/**
 * Generates deterministic resource names for cloud deployments.
 *
 * Pattern: `<tenant>-<project>-<env>` (tenant segment omitted when the
 * deploy isn't tenanted).
 *
 * All segments are slugified (lowercase, alphanumeric + dashes, max 63
 * chars). One app per workspace — see `alepha platform`.
 */
export class NamingService {
  public forContext(
    project: string,
    env: string,
    tenant?: string,
  ): NamingContext {
    const prefix = [tenant, project, env]
      .filter((segment): segment is string => !!segment)
      .map((segment) => this.slugify(segment))
      .join("-");
    return new NamingContext(prefix);
  }

  public slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63);
  }
}

export class NamingContext {
  protected readonly prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  public worker(): string {
    return this.prefix;
  }

  public d1(): string {
    return this.prefix;
  }

  public hyperdrive(): string {
    return this.prefix;
  }

  public r2(): string {
    return this.prefix;
  }

  public analytics(): string {
    return this.prefix;
  }

  public kv(): string {
    return this.prefix;
  }

  public queue(): string {
    return this.prefix;
  }
}
