/**
 * Generates deterministic resource names for cloud deployments.
 *
 * Pattern: <project>-<env>[-<app>]
 *
 * All segments are slugified (lowercase, alphanumeric + dashes, max 63 chars).
 */
export class NamingService {
  public forContext(project: string, env: string): NamingContext {
    const prefix = `${this.slugify(project)}-${this.slugify(env)}`;
    return new NamingContext(prefix, this);
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
  protected readonly naming: NamingService;

  constructor(prefix: string, naming: NamingService) {
    this.prefix = prefix;
    this.naming = naming;
  }

  public worker(app?: string): string {
    return app ? `${this.prefix}-${this.naming.slugify(app)}` : this.prefix;
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

  public kv(app?: string): string {
    return app ? `${this.prefix}-${this.naming.slugify(app)}` : this.prefix;
  }

  public queue(app?: string): string {
    return app ? `${this.prefix}-${this.naming.slugify(app)}` : this.prefix;
  }
}
