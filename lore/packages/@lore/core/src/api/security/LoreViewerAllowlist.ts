/**
 * Whether a rank only reads.
 *
 * Viewer is a plain read-only rank: every `:read` of the project's enabled
 * capabilities, given by an admin to someone they invited
 * (`ProjectRankPresets`). It is no longer an allowlist held against
 * strangers, since a project has one way in, an invitation (#Q3833).
 *
 * Imports nothing, so the browser can read it.
 */
export class LoreViewerAllowlist {
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
}
