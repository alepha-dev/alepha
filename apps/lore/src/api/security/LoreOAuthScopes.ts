import type { OAuthScope } from "alepha/api/oauth";

/**
 * The OAuth scopes Lore offers a connected app: the sentence its consent
 * screen shows, and the permissions a token granted it may use.
 *
 * A granted scope's `permissions` become the access token's
 * `permissionScope`, so a connected app reaches what its scopes declare and
 * never more than its user's ranks and roles allow (#Q2307). The list is
 * resolved at every mint, so a change here applies to a connection at its
 * next refresh.
 *
 * ## The policy, decided by the owner on 2026-09-13
 *
 * - **`mcp` and `cli` reach every permission group a project member uses**,
 *   and nothing under `admin:*`. Before this, a token acted with its user's
 *   full roles, so an administrator who connected Claude or ran `lore login`
 *   handed that client admin. An administrator's MCP connection and CLI can
 *   no longer run admin actions; the admin pages, from a signed-in session,
 *   still can.
 * - **The two lists are the same.** `cli` was to add what `lore deploy`, the
 *   artifact commands and the attachment upload need, and every one of those
 *   routes is already inside a member group (`deploy`, `app`, `artifact`,
 *   `estate`, `release`, `quality`, and the framework's `file` for uploads).
 *   They stay two entries because the device approval page must name the
 *   terminal rather than Claude.
 * - **`openid` reaches nothing.** It says who you are.
 *
 * ## Left out on purpose
 *
 * `api-key`: minting and revoking keys is refused to any connected app by
 * D10 whatever its scope, and listing them is nothing a project client needs.
 *
 * ## ⚠️ A new permission group must be placed
 *
 * Written out rather than derived from the registry, because "everything
 * that is not admin" is exactly the rule that lets a future admin-grade group
 * named something else reach every connected app silently.
 * `oauth-scope-permissions.spec.ts` boots Lore and fails on any registered
 * group that is neither listed here, nor under `admin:`, nor left out above,
 * so the decision is made when the group is added.
 */
export class LoreOAuthScopes {
  /**
   * The permission groups a project member uses, as the connected-app
   * scopes reach them.
   */
  public static readonly MEMBER_GROUPS: string[] = [
    // The project itself, and what every project has whatever its
    // capabilities: `LorePermissions`' Core groups.
    "project",
    "member",
    "rank",
    "capability",
    "invitation",
    "stats",
    // One group per capability surface.
    "quest",
    "epic",
    "release",
    "area",
    "folio",
    "feedback",
    "blight",
    "quality",
    "app",
    "sigil",
    "artifact",
    "deploy",
    "estate",
    // The framework's file upload, which quest and folio attachments go
    // through before they are registered on their project.
    "file",
  ];

  /**
   * Groups a connected app never reaches although they are not `admin:`.
   * Each has its reason in the class JSDoc.
   */
  public static readonly EXCLUDED_GROUPS: string[] = ["api-key"];

  /**
   * The member groups as the patterns a scope declaration takes.
   */
  public static readonly MEMBER_PERMISSIONS: string[] =
    LoreOAuthScopes.MEMBER_GROUPS.map((group) => `${group}:*`);

  /**
   * What `oauthOptions.scopes` is set to in `main.server.ts`.
   */
  public static readonly SCOPES: Record<string, OAuthScope> = {
    /*
     * ⚠️ `mcp` is one scope and it is the whole project surface. A client
     * holding it reads and writes every project this account is a member of:
     * quests, folios, feedback, blights, the lot. The copy says so in those
     * words rather than in the word "mcp", which tells a reader nothing about
     * what they are handing over.
     */
    mcp: {
      label: "Your projects",
      description:
        "Read and manage the projects you are a member of - their quests, folios, feedback and blights.",
      permissions: LoreOAuthScopes.MEMBER_PERMISSIONS,
    },
    /*
     * What `lore login` asks for (#Q2244). Its own entry so the device
     * approval page names the terminal rather than Claude's MCP connection.
     */
    cli: {
      label: "Your account, from the terminal",
      description:
        "What the lore command does as you: push builds and reports, deploy your apps, and read or manage the projects you are a member of.",
      permissions: LoreOAuthScopes.MEMBER_PERMISSIONS,
    },
    openid: {
      label: "Who you are",
      description: "Your name and email address, so it can tell it is you.",
      permissions: [],
    },
  };
}
