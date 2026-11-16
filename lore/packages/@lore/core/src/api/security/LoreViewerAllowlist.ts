/**
 * What the Viewer rank may hold: the rank an open project's joiners get.
 *
 * In an open project anyone signed in can become a viewer, so a viewer is
 * assumed hostile (folio "Open projects: safety contract"). The rank is an
 * **allowlist, not a denylist**: a permission that is not listed here is
 * refused, including any permission added later.
 *
 * A viewer reads the project's memory: quests (with their comments,
 * objectives and tags), epics, folios, releases, the roadmap and the areas,
 * and Plan's Requirements: personas, use cases and requirements (#E153).
 * Nothing else, and no write at all. Other members reach a viewer only as a
 * public card, name and avatar, because `member:read` is not listed.
 *
 * ## ⚠️ A new permission group must be placed
 *
 * Written out rather than derived from the registry, for the reason
 * `LoreOAuthScopes` is: "every `:read`" is exactly the rule that let
 * automations, errors and hosts reach a viewer. `viewer-allowlist.spec.ts`
 * boots Lore and fails on any registered group that is in neither
 * {@link READ_GROUPS} nor {@link CLOSED_GROUPS}, so the decision is made when
 * the group is added.
 *
 * Imports nothing, so the rank editor can read it in the browser.
 */
export class LoreViewerAllowlist {
  /**
   * The groups whose `:read` a viewer holds. `project:read` is the floor
   * every rank holds anyway.
   */
  public static readonly READ_GROUPS: string[] = [
    "project",
    "quest",
    "epic",
    "release",
    "area",
    "folio",
    // Plan's Requirements (#E153, answer 22): a viewer reads them.
    "persona",
    "usecase",
    "requirement",
  ];

  /**
   * The groups a viewer holds nothing of, each for its reason:
   *
   * - `member`: the member list carries emails and full user records.
   * - `rank`, `capability`, `invitation`: the project's configuration.
   * - `stats`: reports break the work down per person.
   * - `automation`: rules, their variables and their run payloads.
   * - `feedback`: end-user reports and their attachments.
   * - `error`, `quality`, `app`, `sigil`, `artifact`, `deploy`, `host`:
   *   telemetry and infrastructure.
   * - `file`, `api-key`, `organization`, `admin`: plumbing and the
   *   application's own administration.
   */
  public static readonly CLOSED_GROUPS: string[] = [
    "member",
    "rank",
    "capability",
    "invitation",
    "stats",
    "automation",
    "feedback",
    "error",
    "quality",
    "app",
    "sigil",
    "artifact",
    "deploy",
    "host",
    "file",
    "api-key",
    "organization",
    "admin",
  ];

  /**
   * The allowlist itself, as the permission strings a rank stores.
   */
  public static readonly PERMISSIONS: string[] =
    LoreViewerAllowlist.READ_GROUPS.map((group) => `${group}:read`);

  /**
   * Whether a permission set grants reads only: what the Viewer rank holds,
   * and any custom rank made of reads. The surfaces that tell a reader they
   * are read-only in a project (a refused write, `project_context`) read it.
   */
  public static isReadOnly(permissions: readonly string[]): boolean {
    return (
      permissions.length > 0 &&
      permissions.every(
        (permission) =>
          permission.endsWith(":read") && !permission.includes("*"),
      )
    );
  }

  /**
   * The permissions of `permissions` the allowlist does not cover, in their
   * stored order. Empty when the set fits.
   *
   * A wildcard (`*`, `quest:*`) is never covered: it grants whatever its
   * prefix will ever name.
   */
  public static extrasOf(permissions: readonly string[]): string[] {
    return permissions.filter(
      (permission) => !LoreViewerAllowlist.PERMISSIONS.includes(permission),
    );
  }
}
