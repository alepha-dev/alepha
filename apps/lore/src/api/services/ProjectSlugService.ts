/**
 * Derives and validates a project's URL identity.
 *
 * A slug is a **root-level path segment** (`/sds/quests/19`), so it is unique
 * across the whole instance and must not collide with any static route the
 * router registers at the root.
 *
 * ⚠️ This class deliberately declares **no injected dependencies**. The project
 * settings page constructs it in the browser to decide whether an edit moves
 * the project's URL, which is what gates the rename confirmation, so that
 * decision cannot drift from what the server stores. Adding a `$repository`
 * here would drag server-only code into the client bundle — the availability
 * check that needs the database lives on `ProjectController`.
 */
export class ProjectSlugService {
  /**
   * Root-level path segments the router already owns, plus a few that are
   * reachable as static assets. A project may not take any of them.
   *
   * Slugs shorter than 3 characters cannot be produced (the title schema
   * enforces a 3-char minimum), but the short entries are kept so this list
   * reads as "the root namespace" rather than "whatever happens to be
   * reachable today".
   */
  protected readonly reserved = new Set([
    "account",
    "auth",
    "oauth",
    "api",
    "mcp",
    "admin",
    "new-project",
    "p",
    "q",
    "sigils",
    "assets",
    "static",
    "public",
    "files",
    "login",
    "register",
    "settings",
    "robots",
    "manifest",
    "favicon",
    "well-known",
    "version",
    "_batch",
    // The locale prefixes: the router strips a leading "/fr" before matching,
    // so a project slugged "fr" (title "Fr-") was served as the French home.
    "fr",
    "en",
  ]);

  /**
   * Reserves the namespace {@link fallbackSlug} draws from, so a project
   * titled "Project 42" cannot claim the slug that belongs to project #42.
   */
  protected readonly fallbackPattern = /^project-\d+$/;

  /**
   * Title → slug.
   *
   * Accents fold to their base letter (`Élan Vital` → `elan-vital`) so a
   * French title produces a usable URL. A title that transliterates to
   * nothing (`日本語`) returns `""` — the caller falls back to
   * {@link fallbackSlug}.
   */
  public slugify(title: string): string {
    return title
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /**
   * True when the slug would shadow a route the app already owns, or would
   * intrude on the id-fallback namespace.
   */
  public isReserved(slug: string): boolean {
    return this.reserved.has(slug) || this.fallbackPattern.test(slug);
  }

  /**
   * The slug given to a project whose title transliterates to nothing.
   * Unique by construction — project ids are.
   */
  public fallbackSlug(projectId: number): string {
    return `project-${projectId}`;
  }
}
