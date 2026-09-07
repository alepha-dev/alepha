import { $permission } from "alepha/security";

import { LoreRankBounds } from "./LoreRankBounds.ts";

/**
 * Lore's permission vocabulary, declared once.
 *
 * ## ⚠️ These names can never change
 *
 * A rank definition stores permission strings as **data**
 * (`rank_definitions.permissions`), so renaming `folio:write` silently drops
 * it from every custom rank that held it - on a deploy that looks like a
 * relabelling, with nothing going red. It is the same class of failure as the
 * `features.milestones` key that took production down in 2026-08: a name that
 * looks internal, and is not.
 *
 * `group:name` therefore joins the list of identifiers this repository never
 * renames, beside `projects.features`'s keys, the storage bucket literals and
 * `$sequence` property names. What a permission is CALLED is the `label` key,
 * which is free to change because nothing stores it.
 *
 * ## The sizing rule
 *
 * A permission exists when somebody would plausibly grant it to one person and
 * withhold it from another. `folio:read` and `folio:write` yes; a separate
 * permission for reading a folio's title, no. When in doubt, fewer: a matrix
 * of eighty checkboxes is not a feature, it is a dare.
 *
 * ## Groups, and which capability owns each
 *
 * One group per surface, in the shape Alepha Club's own catalogue arrived at
 * (one group per nav destination, `view` gating the page). Which capability
 * owns a group is declared on the **capability**, in
 * `CapabilityRegistry.permissionGroups`, not here: `$permission` stays
 * capability-agnostic because a second consumer has no capabilities at all.
 *
 * The groups no capability claims - `project`, `member`, `rank`, `capability`,
 * `invitation`, `stats` - are Core, and always shown in the matrix. That set
 * is duplicated nowhere: `capability-permission-groups.spec.ts` asserts every
 * declared group is either claimed by a capability or on that list, so a new
 * group cannot become invisible in the matrix while still gating endpoints.
 *
 * ## Two acts no rank may be given, and one it always has
 *
 * `project:delete` and `capability:manage` are **owner-only, structurally**.
 * Both are real registered strings so a gate can read them, and Lore's
 * `$rankResource` lists them as never grantable. `capability:manage` is
 * separate from `project:update` for a reason worth stating: turning a
 * capability ON widens every rank's effective set at once, the actor's own
 * included, and the subset rule does not catch it because a switch is not a
 * grant.
 *
 * `project:read` is a **floor**: every rank holds it. A member whose rank
 * cannot open the project is a removal expressed badly, and removing a member
 * already says it properly.
 *
 * Transferring ownership is deliberately **not** a permission. It is what the
 * `owner` rank IS, structurally, and a permission for it would be a way to
 * give away something the giver holds by identity rather than by grant.
 */
export class LorePermissions {
  /**
   * The floor and the ceiling, re-exported from {@link LoreRankBounds}.
   *
   * ⚠️ They live in a file of their own because THIS file imports
   * `$permission`, whose barrel has no browser condition - so the rank editor
   * cannot import this class at all. Read the note there before moving them
   * back.
   */
  public static readonly FLOOR = LoreRankBounds.FLOOR;

  public static readonly OWNER_ONLY = LoreRankBounds.OWNER_ONLY;

  /**
   * ⚠️ **The acceptance criterion of the whole epic**: what a plain member can
   * do today, derived from the gates themselves.
   *
   * "No existing project changes behaviour" means exactly this list. It is
   * what the built-in `member` rank grants, so a project that never touches
   * its ranks behaves after the epic precisely as it did before.
   *
   * Every entry corresponds to a gate that is member-gated today - no
   * `owner: true`, no `assertOwner` - and `member-permission-defaults.spec.ts`
   * asserts that this list, {@link OWNER_TODAY} and {@link OUT_OF_SCOPE}
   * together cover every declared permission exactly once, so a permission
   * added later cannot quietly land on neither side.
   */
  public static readonly MEMBER_DEFAULT: string[] = [
    "project:read",
    "member:read",
    "stats:read",
    "quest:read",
    "quest:create",
    "quest:update",
    "quest:delete",
    "epic:read",
    "epic:write",
    "release:read",
    "area:read",
    "folio:read",
    "folio:write",
    "app:read",
    "artifact:read",
    "blight:read",
    "quality:read",
    "estate:read",
    "feedback:read",
  ];

  /**
   * What only the project's owner can do today.
   *
   * Grantable to a rank - that is the whole point of the epic - but absent
   * from {@link MEMBER_DEFAULT}, so nothing changes until somebody creates a
   * rank that carries one. {@link OWNER_ONLY} is the subset of these that
   * never becomes grantable.
   */
  public static readonly OWNER_TODAY: string[] = [
    "project:update",
    "project:delete",
    "capability:manage",
    "member:manage",
    "rank:manage",
    "invitation:create",
    "release:manage",
    "area:manage",
    "app:manage",
    "deploy:manage",
    "sigil:manage",
    "blight:triage",
    "estate:lend",
    "feedback:triage",
  ];

  /**
   * Application-scope permissions that no project rank ever narrows.
   *
   * There is no project to hold a rank in when a project is created, and an
   * estate is owned by a USER and merely lent to a project - so creating,
   * editing and deleting one happen on the owner's own account page, outside
   * every project scope. Only the lending is per project, and that is
   * `estate:lend`.
   */
  public static readonly OUT_OF_SCOPE = LoreRankBounds.OUT_OF_SCOPE;

  // ---------------------------------------------------------------------------
  // Core: the project itself. No capability owns these, so they are always in
  // the matrix, including for a project with every capability switched off.
  // ---------------------------------------------------------------------------

  /**
   * The floor. Every rank holds it, and the editor renders it all-on and
   * non-editable.
   */
  projectRead = $permission({
    group: "project",
    name: "read",
    label: "permission.project.read",
    groupLabel: "permission.group.project",
    groupOrder: 1,
  });

  /**
   * The project's **identity**: title, description, slug, icon, repository
   * URL, roadmap visibility.
   *
   * ⚠️ It used to gate `setCapability` as well, which made an Admin able to
   * widen every rank at once. That act is `capability:manage` now.
   */
  projectUpdate = $permission({
    group: "project",
    name: "update",
    label: "permission.project.update",
  });

  /**
   * Owner-only, structurally. Registered so the gate can name it; never
   * grantable to a rank.
   */
  projectDelete = $permission({
    group: "project",
    name: "delete",
    label: "permission.project.delete",
  });

  /**
   * Creating a project is an application-scope act - there is no project to
   * hold a rank in yet - so no rank ever narrows it.
   */
  projectCreate = $permission({
    group: "project",
    name: "create",
    label: "permission.project.create",
  });

  memberRead = $permission({
    group: "member",
    name: "read",
    label: "permission.member.read",
    groupLabel: "permission.group.member",
    groupOrder: 2,
  });

  /**
   * Invite, revoke an invitation, remove a member, and assign a rank **below
   * owner**. Grantable, and the Admin preset carries it.
   */
  memberManage = $permission({
    group: "member",
    name: "manage",
    label: "permission.member.manage",
  });

  /**
   * Editing what the ranks of this project mean.
   *
   * Grantable under the subset rule - an editor only ever touches ranks whose
   * set is within its own, re-checked on every write - and the Admin preset
   * carries it.
   */
  rankManage = $permission({
    group: "rank",
    name: "manage",
    label: "permission.rank.manage",
    groupLabel: "permission.group.rank",
    groupOrder: 3,
  });

  /**
   * Turning a capability on or off.
   *
   * ⚠️ Owner-only, structurally, and never grantable. Turning one ON widens
   * every rank's effective set at once, the actor's own included, and the
   * subset rule does not catch it: that rule governs what may be GRANTED, and
   * this is a switch.
   */
  capabilityManage = $permission({
    group: "capability",
    name: "manage",
    label: "permission.capability.manage",
    groupLabel: "permission.group.capability",
    groupOrder: 4,
  });

  invitationCreate = $permission({
    group: "invitation",
    name: "create",
    label: "permission.invitation.create",
    groupLabel: "permission.group.invitation",
    groupOrder: 5,
  });

  /**
   * Reports. Core, like the Activity feed: each of its tabs declares its own
   * capability, and the page itself never disappears.
   */
  statsRead = $permission({
    group: "stats",
    name: "read",
    label: "permission.stats.read",
    groupLabel: "permission.group.stats",
    groupOrder: 6,
  });

  // ---------------------------------------------------------------------------
  // Work
  // ---------------------------------------------------------------------------

  questRead = $permission({
    group: "quest",
    name: "read",
    label: "permission.quest.read",
    groupLabel: "permission.group.quest",
    groupOrder: 10,
  });

  questCreate = $permission({
    group: "quest",
    name: "create",
    label: "permission.quest.create",
  });

  /**
   * Editing a quest, and every state move on it: accept, complete, reopen,
   * shelve, assign, move on the board.
   */
  questUpdate = $permission({
    group: "quest",
    name: "update",
    label: "permission.quest.update",
  });

  questDelete = $permission({
    group: "quest",
    name: "delete",
    label: "permission.quest.delete",
  });

  epicRead = $permission({
    group: "epic",
    name: "read",
    label: "permission.epic.read",
    groupLabel: "permission.group.epic",
    groupOrder: 11,
  });

  /**
   * Creating, editing, attaching to and advancing an epic.
   *
   * One verb rather than the quest's four, by the sizing rule: nobody grants
   * "may create an epic but not rename one".
   */
  epicWrite = $permission({
    group: "epic",
    name: "write",
    label: "permission.epic.write",
  });

  releaseRead = $permission({
    group: "release",
    name: "read",
    label: "permission.release.read",
    groupLabel: "permission.group.release",
    groupOrder: 12,
  });

  releaseManage = $permission({
    group: "release",
    name: "manage",
    label: "permission.release.manage",
  });

  areaRead = $permission({
    group: "area",
    name: "read",
    label: "permission.area.read",
    groupLabel: "permission.group.area",
    groupOrder: 13,
  });

  /**
   * Renaming, merging and deleting an area, and editing its description.
   */
  areaManage = $permission({
    group: "area",
    name: "manage",
    label: "permission.area.manage",
  });

  // ---------------------------------------------------------------------------
  // Knowledge
  // ---------------------------------------------------------------------------

  folioRead = $permission({
    group: "folio",
    name: "read",
    label: "permission.folio.read",
    groupLabel: "permission.group.folio",
    groupOrder: 20,
  });

  /**
   * Writing a folio, its directories and its attachments. One verb across all
   * three: a folio tree nobody may reorganise is a folio tree nobody may
   * write.
   */
  folioWrite = $permission({
    group: "folio",
    name: "write",
    label: "permission.folio.write",
  });

  // ---------------------------------------------------------------------------
  // Apps
  // ---------------------------------------------------------------------------

  appRead = $permission({
    group: "app",
    name: "read",
    label: "permission.app.read",
    groupLabel: "permission.group.app",
    groupOrder: 30,
  });

  /**
   * Creating, renaming and deleting a deployed copy, and editing its address
   * and its estate.
   */
  appManage = $permission({
    group: "app",
    name: "manage",
    label: "permission.app.manage",
  });

  /**
   * Minting, rotating and deleting the credential a deployed copy reports
   * with.
   *
   * Its own group rather than a verb on `app` because it is the one act on
   * this page that hands out a secret, and an operator may reasonably let
   * somebody rename an app without letting them mint a token.
   */
  sigilManage = $permission({
    group: "sigil",
    name: "manage",
    label: "permission.sigil.manage",
    groupLabel: "permission.group.sigil",
    groupOrder: 31,
  });

  /**
   * Starting a deploy, rolling one back, and setting the variables a deployed
   * copy runs with.
   *
   * Its own group rather than a verb on `app`, for the reason `sigil:manage`
   * is: an operator may reasonably let somebody rename an app without letting
   * them push code into their cloud account. It is the most powerful act in
   * Lore - `NamingService` derives every resource as `<project>-<env>`, so a
   * deploy at `production` resolves the live database, the live bucket and the
   * live worker, with no sandbox between a valid caller and any of it.
   *
   * ⚠️ Grantable, and on nobody by default. `MEMBER_DEFAULT` does not carry
   * it, so nothing changes until an owner creates a rank that does.
   */
  deployManage = $permission({
    group: "deploy",
    name: "manage",
    label: "permission.deploy.manage",
    groupLabel: "permission.group.deploy",
    groupOrder: 36,
  });

  artifactRead = $permission({
    group: "artifact",
    name: "read",
    label: "permission.artifact.read",
    groupLabel: "permission.group.artifact",
    groupOrder: 32,
  });

  blightRead = $permission({
    group: "blight",
    name: "read",
    label: "permission.blight.read",
    groupLabel: "permission.group.blight",
    groupOrder: 33,
  });

  /**
   * Resolving a blight, ignoring one by rule, forwarding one to a quest and
   * deleting one.
   */
  blightTriage = $permission({
    group: "blight",
    name: "triage",
    label: "permission.blight.triage",
  });

  qualityRead = $permission({
    group: "quality",
    name: "read",
    label: "permission.quality.read",
    groupLabel: "permission.group.quality",
    groupOrder: 34,
  });

  estateRead = $permission({
    group: "estate",
    name: "read",
    label: "permission.estate.read",
    groupLabel: "permission.group.estate",
    groupOrder: 35,
  });

  estateUpdate = $permission({
    group: "estate",
    name: "update",
    label: "permission.estate.update",
  });

  /**
   * Lending an estate to a project, and taking it back.
   *
   * ⚠️ An estate is owned by a USER and lent to a project, so `estate:create`
   * and `estate:delete` are application-scope acts on the owner's own account
   * page and no rank narrows them. Only the lending is per project.
   */
  estateLend = $permission({
    group: "estate",
    name: "lend",
    label: "permission.estate.lend",
  });

  estateCreate = $permission({
    group: "estate",
    name: "create",
    label: "permission.estate.create",
  });

  estateDelete = $permission({
    group: "estate",
    name: "delete",
    label: "permission.estate.delete",
  });

  // ---------------------------------------------------------------------------
  // Support
  // ---------------------------------------------------------------------------

  feedbackRead = $permission({
    group: "feedback",
    name: "read",
    label: "permission.feedback.read",
    groupLabel: "permission.group.feedback",
    groupOrder: 40,
  });

  /**
   * Accepting a feedback item into quests, rejecting it, and removing it.
   */
  feedbackTriage = $permission({
    group: "feedback",
    name: "triage",
    label: "permission.feedback.triage",
  });
}
