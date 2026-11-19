/**
 * Which permission reads each kind of row in a project's activity feed
 * (#Q3794).
 *
 * The feed is behind `project:read`, the floor every rank holds, so the gate
 * says nothing about what a reader may see in it. Each row is shown only to
 * a reader whose rank holds the permission its kind names here: a custom
 * rank without `feedback:read` reads no feedback title, one without
 * `member:read` no member event.
 *
 * ## ⚠️ A new audit type must be placed
 *
 * Written out rather than derived, so a new type is placed on purpose.
 * A type with no entry is shown to nobody but the owner, and
 * `viewer-closed-reads.spec.ts` fails on any project-layer type missing from
 * the list, so the decision is made when the type is added.
 *
 * Imports nothing, so a page can read it in the browser.
 */
export class LoreActivityPermissions {
  public static readonly OF: Record<string, string> = {
    project: "project:read",
    quest: "quest:read",
    epic: "epic:read",
    release: "release:read",
    folio: "folio:read",
    feedback: "feedback:read",
    member: "member:read",
    app: "app:read",
    sigil: "app:read",
    monitor: "app:read",
    host: "host:read",
    persona: "persona:read",
    usecase: "usecase:read",
    requirement: "requirement:read",
  };

  /**
   * Whether a reader holding `permissions` may see rows of this kind.
   * A wildcard (`*`, `quest:*`) grants what its prefix names.
   */
  public static reads(permissions: readonly string[], type: string): boolean {
    const needed = LoreActivityPermissions.OF[type];
    return permissions.some(
      (granted) =>
        granted === "*" ||
        (needed !== undefined &&
          (granted === needed ||
            (granted.endsWith("*") &&
              needed.startsWith(granted.slice(0, -1))))),
    );
  }
}
