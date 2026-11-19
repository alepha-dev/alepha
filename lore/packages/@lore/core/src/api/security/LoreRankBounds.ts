/**
 * The floor and the ceiling of what a rank may hold, in a file the browser can
 * import.
 *
 * They belong next to {@link LorePermissions} and are not IN it, for one
 * mechanical reason: that file imports `$permission` from `alepha/security`,
 * and the browser condition of that barrel does not export it. A page that
 * reached for `LorePermissions.FLOOR` therefore died at module load with
 * "does not provide an export named '$permission'" - the split-condition
 * barrel trap, which nothing local catches because `yarn v` never builds for
 * the browser condition either.
 *
 * ⚠️ `LorePermissions` re-exports both as its own statics, so there is still
 * one list. Add a permission to the floor or the ceiling HERE.
 */
export class LoreRankBounds {
  /**
   * The floor: every rank holds it, and the editor renders it all-on and
   * non-editable.
   *
   * A list rather than a constant, so a second floor permission is data rather
   * than code.
   */
  public static readonly FLOOR: string[] = ["project:read"];

  /**
   * The ceiling: never grantable to any rank, whatever the writer holds.
   *
   * Deleting the project is the owner's alone, hard-coded (#Q3736): it ends
   * the project for everybody. `capability:manage` left this list then, on
   * the owner's decision that an Admin does everything else: an admin who
   * switches a capability on widens every rank at once, their own included,
   * and that is accepted.
   */
  public static readonly OWNER_ONLY: string[] = ["project:delete"];

  /**
   * The ranks every project holds, renamable and never deleted (#Q3736):
   * `owner` and `member` are the framework's own built-ins, `admin` is read
   * from the code until edited (`organizationConfigAtom.defaultRanks`,
   * #Q3920), and `viewer` is seeded by `DefaultRankService` under its key.
   */
  public static readonly BUILTIN_RANKS = [
    "owner",
    "admin",
    "member",
    "viewer",
  ] as const;

  /**
   * Application-scope permissions the matrix does not list at all.
   *
   * Different from the ceiling, and the difference is worth the second list.
   * A ceiling permission belongs to the project and is withheld from every
   * rank, so a reader is right to look for it and right to find it locked.
   * These belong to no project: there is no project to hold a rank in when
   * one is created. A locked row for one of them would be answering a
   * question nobody asked on this page. (A host's create, update and
   * delete were here until #E126 homed hosts in a project.)
   */
  public static readonly OUT_OF_SCOPE: string[] = [
    "project:create",
    // The organization behind a project is plumbing Lore never shows: it is
    // created with the project, renamed with it, and its deletion is refused
    // outright (`LoreOrganizationPolicyProvider`). The framework still
    // declares and gates both, so they are withheld from every rank too, in
    // {@link LoreRankBounds.NEVER_GRANTED}.
    "organization:update",
    "organization:delete",
  ];

  /**
   * Every permission the server refuses to put in a rank, whoever writes it:
   * the ceiling, and the organization's own two acts.
   *
   * ⚠️ This is what `organizationConfigAtom.ownerOnly` is set to. Setting it
   * to {@link OWNER_ONLY} alone replaced the framework's default
   * (`organization:delete`) instead of adding to it, and the rank editor then
   * offered both organization permissions as ordinary checkboxes.
   */
  public static readonly NEVER_GRANTED: string[] = [
    ...LoreRankBounds.OWNER_ONLY,
    "organization:update",
    "organization:delete",
  ];
}
