/**
 * Generates deterministic resource names for cloud deployments.
 *
 * Pattern: `<project>-<env>`. All segments are slugified (lowercase,
 * alphanumeric + dashes, max 63 chars). One app per workspace, see
 * `alepha platform`.
 */
export class NamingService {
  public forContext(project: string, env: string): NamingContext {
    const prefix = [project, env]
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
