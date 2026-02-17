/**
 * Generates deterministic resource names for cloud deployments.
 *
 * Pattern: alepha-<env>-<project>-<resource>[-<app>]
 *
 * All segments are slugified (lowercase, alphanumeric + dashes, max 63 chars).
 */
export class NamingService {
  public forContext(project: string, env: string): NamingContext {
    const prefix = `alepha-${this.slugify(env)}-${this.slugify(project)}`;
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
    return app
      ? `${this.prefix}-worker-${this.naming.slugify(app)}`
      : `${this.prefix}-worker`;
  }

  public d1(): string {
    return `${this.prefix}-d1-main`;
  }

  public r2(): string {
    return `${this.prefix}-r2`;
  }

  public kv(app?: string): string {
    return app
      ? `${this.prefix}-kv-${this.naming.slugify(app)}`
      : `${this.prefix}-kv`;
  }

  public queue(app?: string): string {
    return app
      ? `${this.prefix}-queue-${this.naming.slugify(app)}`
      : `${this.prefix}-queue`;
  }
}
