/**
 * Generates deterministic resource names for cloud deployments.
 *
 * Pattern: `<project>-<env>`, where `project` is the prefix
 * `InfraInspector` resolves: the app name, behind `infra({ project })`
 * when one is set, so `<app>-<env>` or `<project>-<app>-<env>`. All segments
 * are slugified (lowercase, alphanumeric + dashes, max 63 chars). One app per
 * workspace, see `alepha infra`.
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

  /**
   * The KV namespace title, suffixed with the jurisdiction when there is one.
   *
   * A jurisdiction is fixed when a namespace is created, so a global namespace
   * of the unsuffixed name must never be adopted by a jurisdictioned
   * environment: the suffix makes them two names.
   */
  public kv(jurisdiction?: string): string {
    return this.jurisdictioned(this.prefix, jurisdiction, 512);
  }

  /**
   * The queue name, suffixed with the jurisdiction when there is one, for the
   * reason {@link kv} gives.
   *
   * Under a jurisdiction the base is shortened so the name and its `-dlq`
   * dead-letter queue both fit Cloudflare's 63 characters. Without one the
   * name is unchanged, so no existing environment is renamed.
   */
  public queue(jurisdiction?: string): string {
    return this.jurisdictioned(this.prefix, jurisdiction, 63 - "-dlq".length);
  }

  /**
   * `<base>-<jurisdiction>` within `max` characters, shortening the base and
   * never the suffix; the base alone without a jurisdiction.
   */
  protected jurisdictioned(
    base: string,
    jurisdiction: string | undefined,
    max: number,
  ): string {
    if (!jurisdiction) {
      return base;
    }
    const suffix = `-${jurisdiction}`;
    const head = base.slice(0, max - suffix.length).replace(/-+$/, "");
    return `${head}${suffix}`;
  }
}
