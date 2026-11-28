import { $inject, Alepha } from "alepha";
import { users } from "alepha/api/users";
import { BackgroundTaskProvider } from "alepha/background";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "alepha/server";

import { displayName } from "../../web/app/services/displayName.ts";
import {
  type ProjectRepository,
  projectRepositories,
} from "../entities/projectRepositories.ts";
import { projects } from "../entities/projects.ts";
import type { GitHubConnectBody } from "../schemas/githubConnectBodySchema.ts";
import type { GitHubConnectCallbackBody } from "../schemas/githubConnectCallbackBodySchema.ts";
import type { GitHubConnectCallbackResult } from "../schemas/githubConnectCallbackResultSchema.ts";
import type { ProjectGitHubConnection } from "../schemas/projectGitHubConnectionSchema.ts";
import type { ProjectGitHubStatus } from "../schemas/projectGitHubStatusSchema.ts";
import { BestEffort } from "./BestEffort.ts";
import { GitHubAppService } from "./GitHubAppService.ts";
import { GitHubClient, type GitHubRepository } from "./GitHubClient.ts";
import { GitHubStateService } from "./GitHubStateService.ts";
import { GitHubTokenService } from "./GitHubTokenService.ts";
import { LoreAudits } from "./LoreAudits.ts";
import { ProjectSecurityService } from "./ProjectSecurityService.ts";

/**
 * A project's GitHub repository (#Q4362, epic #E177): connected through the
 * instance App's install, one repository per project, kept by GitHub's
 * numeric id.
 *
 * ## Proving the member reaches the repository
 *
 * The install link carries a state bound to the member and the project. The
 * App asks the installer's authorization, so GitHub comes back with a user
 * code: {@link callback} exchanges it for a user token, lists
 * `GET /user/installations/:id/repositories` with it, and offers only what
 * that list holds. The user token serves that one request and is dropped:
 * never stored, never logged. {@link attach} checks again with the App's own
 * token that the installation holds the repository.
 *
 * ## One source of truth for the URL
 *
 * A connected project's `repositoryUrl` is the repository's, written on
 * connect and on a rename; the links read it as they did. While connected,
 * the URL is not edited by hand (`ProjectController.updateProjectById`).
 *
 * ## Lifecycle
 *
 * {@link installationGone}, {@link repositoriesRemoved} and
 * {@link repositoryRenamed} are what GitHub's `installation`,
 * `installation_repositories` and `repository` deliveries do (#Q4364 wires
 * them): the project is left disconnected, saying why, or its names follow
 * the repository.
 */
export class ProjectRepositoryService {
  /**
   * The permission that edits the project's repository URL, and so connects.
   */
  public static readonly PERMISSION = "project:update";

  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly rows = $repository(projectRepositories);
  protected readonly projects = $repository(projects);
  protected readonly users = $repository(users);
  protected readonly apps = $inject(GitHubAppService);
  protected readonly client = $inject(GitHubClient);
  protected readonly tokens = $inject(GitHubTokenService);
  protected readonly states = $inject(GitHubStateService);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly audits = $inject(LoreAudits);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly background = $inject(BackgroundTaskProvider);
  protected readonly bestEffort = $inject(BestEffort);

  protected readonly connectedListeners: Array<
    (row: ProjectRepository) => Promise<unknown>
  > = [];

  /**
   * Runs after every connect, in the background (#Q4367's backfill).
   */
  onConnected(listener: (row: ProjectRepository) => Promise<unknown>): void {
    this.connectedListeners.push(listener);
  }

  async status(projectId: number): Promise<ProjectGitHubStatus> {
    const available = (await this.apps.credentials()) !== undefined;
    const row = await this.rowOf(projectId);
    return {
      available,
      ...(row ? { connection: await this.resource(row) } : {}),
    };
  }

  /**
   * The repository a project is connected to now, or undefined.
   */
  async connectionOf(
    projectId: number,
  ): Promise<ProjectRepository | undefined> {
    const row = await this.rowOf(projectId);
    return row && !row.disconnectedAt ? row : undefined;
  }

  /**
   * The project's row, connected or not: a record made while it was
   * connected still reads its state after a disconnect.
   */
  async latestOf(projectId: number): Promise<ProjectRepository | undefined> {
    return await this.rowOf(projectId);
  }

  /**
   * The connected row holding a GitHub repository, or undefined.
   */
  async byRepositoryId(
    repositoryId: number,
  ): Promise<ProjectRepository | undefined> {
    const [row] = await this.rows.findMany({
      where: { repositoryId: { eq: repositoryId } },
      limit: 1,
    });
    return row && !row.disconnectedAt ? row : undefined;
  }

  /**
   * The App's install page, with a state bound to this member and project.
   */
  async installLink(projectId: number, userId: string): Promise<string> {
    const app = await this.apps.require();
    const state = await this.states.issue({
      purpose: "install",
      userId,
      projectId,
    });
    return `${this.apps.installUrl(app.slug)}?state=${encodeURIComponent(state)}`;
  }

  /**
   * GitHub's return to `/github/connect` after an install.
   */
  async callback(
    user: UserAccountToken,
    body: GitHubConnectCallbackBody,
  ): Promise<GitHubConnectCallbackResult> {
    const state = await this.states.claim(body.state, {
      purpose: "install",
      userId: user.id,
    });
    const projectId = state.projectId;
    if (projectId === undefined) {
      throw new BadRequestError(
        "This GitHub link has expired or was already used. Start again from Lore.",
      );
    }
    const project = await this.requireEditor(projectId, user.id);
    const base = { projectId, projectSlug: project.slug ?? String(projectId) };

    // An organization member who is not its owner only requests the
    // install: GitHub comes back with no installation, and nothing is kept.
    if (body.setupAction === "request" || !body.installationId) {
      return { outcome: "requested", ...base };
    }
    if (!body.code) {
      throw new BadRequestError(
        "GitHub sent no authorization code: install again from Lore",
      );
    }
    // The user token: this request only.
    const user_ = await this.client.exchangeUserCode(body.code);
    // Reach is write: a member who only reads the repository on GitHub
    // would get, through Lore, agent jobs that push and workflows to start.
    const reachable = (
      await this.client.listUserInstallationRepositories(
        user_.token,
        body.installationId,
      )
    ).filter((repo) => repo.push === true);
    if (reachable.length === 0) {
      throw new ForbiddenError(
        "Your GitHub account can push to no repository of this installation",
      );
    }
    if (reachable.length === 1) {
      const connection = await this.attach({
        projectId,
        installationId: body.installationId,
        repositoryId: reachable[0].id,
        user,
        githubUserId: user_.userId,
      });
      return { outcome: "connected", connection, ...base };
    }
    const pick = await this.states.issue({
      purpose: "pick",
      userId: user.id,
      projectId,
      installationId: body.installationId,
      repositoryIds: reachable.slice(0, 200).map((repo) => repo.id),
      ...(user_.userId ? { githubUserId: user_.userId } : {}),
    });
    return {
      outcome: "choose",
      pick,
      repositories: reachable.slice(0, 200).map((repo) => ({
        id: repo.id,
        fullName: repo.fullName,
        private: repo.private,
      })),
      ...base,
    };
  }

  /**
   * Connects one repository: from the callback's choice (`pick`), or by an
   * installation a member of this project already connected through (the
   * CLI's way: it has no user code to prove reach with).
   */
  async connect(
    projectId: number,
    user: UserAccountToken,
    body: GitHubConnectBody,
  ): Promise<ProjectGitHubConnection> {
    if (body.pick) {
      const pick = await this.states.claim(body.pick, {
        purpose: "pick",
        userId: user.id,
        projectId,
      });
      if (
        !pick.installationId ||
        !(pick.repositoryIds ?? []).includes(body.repositoryId)
      ) {
        throw new ForbiddenError(
          "That repository was not among the ones your GitHub account reaches",
        );
      }
      return await this.attach({
        projectId,
        installationId: pick.installationId,
        repositoryId: body.repositoryId,
        user,
        githubUserId: pick.githubUserId,
      });
    }
    if (!body.installationId) {
      throw new BadRequestError(
        "Give the installation a member of this project connected through, or connect from the browser",
      );
    }
    if (!(await this.installationKnownTo(projectId, body.installationId))) {
      throw new ForbiddenError(
        "No member of this project connected a repository through that installation: install the App from the project's settings in a browser, which proves you reach the repository",
      );
    }
    return await this.attach({
      projectId,
      installationId: body.installationId,
      repositoryId: body.repositoryId,
      user,
    });
  }

  async disconnect(
    projectId: number,
    user: UserAccountToken | undefined,
  ): Promise<ProjectGitHubStatus> {
    const row = await this.connectionOf(projectId);
    if (!row)
      throw new NotFoundError("This project is not connected to GitHub");
    await this.rows.updateById(row.id, {
      disconnectedAt: this.dateTime.nowISOString(),
      disconnectReason: "member",
    });
    // No token minted for the repository outlives its connection here.
    this.tokens.forget(row.installationId);
    await this.audits.github.logSuccess("disconnect", {
      ...this.audits.actor(user),
      ...this.audits.scope(projectId),
      resourceType: "github-repository",
      resourceId: String(row.repositoryId),
      description: `${row.owner}/${row.name}`,
    });
    return await this.status(projectId);
  }

  // ---- lifecycle, from GitHub's deliveries (#Q4364) ---------------------

  /**
   * The App was uninstalled or suspended: every project connected through
   * the installation is left disconnected, saying why.
   */
  async installationGone(
    installationId: number,
    reason: "uninstalled" | "suspended",
  ): Promise<number> {
    this.tokens.forget(installationId);
    const rows = await this.rows.findMany({
      where: {
        installationId: { eq: installationId },
        disconnectedAt: { isNull: true },
      },
    });
    for (const row of rows) await this.markGone(row, reason);
    return rows.length;
  }

  /**
   * Repositories removed from an installation.
   */
  async repositoriesRemoved(
    installationId: number,
    repositoryIds: number[],
  ): Promise<number> {
    if (repositoryIds.length === 0) return 0;
    this.tokens.forget(installationId);
    const rows = await this.rows.findMany({
      where: {
        installationId: { eq: installationId },
        repositoryId: { inArray: repositoryIds },
        disconnectedAt: { isNull: true },
      },
    });
    for (const row of rows) await this.markGone(row, "removed");
    return rows.length;
  }

  /**
   * A repository renamed or transferred: its names follow, the link with it.
   */
  async repositoryRenamed(
    repositoryId: number,
    next: { owner: string; name: string; defaultBranch?: string },
  ): Promise<boolean> {
    const [row] = await this.rows.findMany({
      where: { repositoryId: { eq: repositoryId } },
      limit: 1,
    });
    if (!row) return false;
    const before = `${row.owner}/${row.name}`;
    const after = `${next.owner}/${next.name}`;
    const formerNames =
      before.toLowerCase() === after.toLowerCase()
        ? (row.formerNames ?? [])
        : [before, ...(row.formerNames ?? []).filter((it) => it !== before)]
            .filter((it) => it.toLowerCase() !== after.toLowerCase())
            .slice(0, 10);
    await this.rows.updateById(row.id, {
      owner: next.owner,
      name: next.name,
      ...(next.defaultBranch ? { defaultBranch: next.defaultBranch } : {}),
      formerNames,
    });
    if (!row.disconnectedAt) {
      await this.projects.updateById(row.projectId, {
        repositoryUrl: `https://github.com/${after}`,
      });
    }
    return true;
  }

  /**
   * Whether `owner/name` names this row's repository, now or before a
   * rename (#Q4367).
   */
  names(row: ProjectRepository, fullName: string): boolean {
    const wanted = fullName.toLowerCase();
    return (
      `${row.owner}/${row.name}`.toLowerCase() === wanted ||
      (row.formerNames ?? []).some((it) => it.toLowerCase() === wanted)
    );
  }

  /**
   * A read-only installation token for a connected project: Lore's own
   * reads (the backfill, an author's permission).
   */
  async readToken(row: ProjectRepository): Promise<string> {
    return (
      await this.tokens.installationToken({
        installationId: row.installationId,
        repositoryId: row.repositoryId,
        permissions: GitHubTokenService.READ,
      })
    ).token;
  }

  // ---- internals ---------------------------------------------------------

  /**
   * Writes the connection, after the App's own check that the installation
   * holds the repository.
   */
  protected async attach(input: {
    projectId: number;
    installationId: number;
    repositoryId: number;
    user: UserAccountToken;
    githubUserId?: number;
  }): Promise<ProjectGitHubConnection> {
    await this.requireEditor(input.projectId, input.user.id);
    const token = await this.tokens.installationToken({
      installationId: input.installationId,
      repositoryId: input.repositoryId,
      permissions: GitHubTokenService.READ,
    });
    let repository: GitHubRepository;
    try {
      repository = await this.client.getRepository(
        token.token,
        input.repositoryId,
      );
    } catch {
      throw new ForbiddenError(
        "The GitHub App's installation does not hold that repository",
      );
    }

    const holders = await this.rows.findMany({
      where: { repositoryId: { eq: repository.id } },
    });
    const elsewhere = holders.find(
      (row) => row.projectId !== input.projectId && !row.disconnectedAt,
    );
    if (elsewhere) {
      throw new ConflictError(
        `${repository.fullName} is already connected to another Lore project: a repository belongs to one project, so a webhook never has to guess which project a #Q reference means. Disconnect it there first.`,
      );
    }
    // A disconnected row of another project, and this project's own row
    // whatever it holds, make way for the new one.
    await this.rows.deleteMany({ repositoryId: { eq: repository.id } });
    await this.rows.deleteMany({ projectId: { eq: input.projectId } });
    let row: ProjectRepository;
    try {
      row = await this.rows.create({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        installationId: input.installationId,
        repositoryId: repository.id,
        owner: repository.owner,
        name: repository.name,
        defaultBranch: repository.defaultBranch,
        connectedBy: input.user.id,
        ...(input.githubUserId
          ? { connectedByGithubId: input.githubUserId }
          : {}),
        connectedAt: this.dateTime.nowISOString(),
      });
    } catch {
      throw new ConflictError(
        `${repository.fullName} was just connected to another Lore project`,
      );
    }
    await this.projects.updateById(input.projectId, {
      repositoryUrl: `https://github.com/${repository.fullName}`,
    });
    // What follows a connect (the backfill of #Q4367), after the answer and
    // best effort: a listener registers, since the state service reads
    // connections through this one.
    for (const listener of this.connectedListeners) {
      this.background.defer(async () => {
        await this.bestEffort.run("github connected", () => listener(row));
      });
    }
    await this.audits.github.logSuccess("connect", {
      ...this.audits.actor(input.user),
      ...this.audits.scope(input.projectId),
      resourceType: "github-repository",
      resourceId: String(repository.id),
      description: repository.fullName,
    });
    return await this.resource(row);
  }

  protected async markGone(
    row: ProjectRepository,
    reason: "uninstalled" | "suspended" | "removed",
  ): Promise<void> {
    await this.rows.updateById(row.id, {
      disconnectedAt: this.dateTime.nowISOString(),
      disconnectReason: reason,
    });
    await this.audits.github.logSuccess("disconnect", {
      ...this.audits.scope(row.projectId),
      severity: "warning",
      resourceType: "github-repository",
      resourceId: String(row.repositoryId),
      description: `${row.owner}/${row.name}`,
      metadata: { reason },
    });
  }

  /**
   * Whether a member of this project connected a repository through this
   * installation before, in any project: the CLI's stand-in for the proof a
   * user code gives.
   */
  protected async installationKnownTo(
    projectId: number,
    installationId: number,
  ): Promise<boolean> {
    const rows = await this.rows.findMany({
      where: { installationId: { eq: installationId } },
    });
    for (const row of rows) {
      if (
        row.connectedBy &&
        (await this.security.isMemberById(projectId, row.connectedBy))
      ) {
        return true;
      }
    }
    return false;
  }

  protected async requireEditor(
    projectId: number,
    userId: string,
  ): Promise<{ slug?: string }> {
    const [project] = await this.projects.findMany({
      where: { id: { eq: projectId } },
      limit: 1,
    });
    if (!project) throw new NotFoundError("Project not found");
    if (
      !(await this.security.holds(
        projectId,
        userId,
        ProjectRepositoryService.PERMISSION,
      ))
    ) {
      throw new ForbiddenError(
        `Connecting GitHub needs ${ProjectRepositoryService.PERMISSION} in this project`,
      );
    }
    return { slug: project.slug ?? undefined };
  }

  protected async rowOf(
    projectId: number,
  ): Promise<ProjectRepository | undefined> {
    const [row] = await this.rows.findMany({
      where: { projectId: { eq: projectId } },
      limit: 1,
    });
    return row;
  }

  protected async resource(
    row: ProjectRepository,
  ): Promise<ProjectGitHubConnection> {
    let connectedBy: ProjectGitHubConnection["connectedBy"];
    if (row.connectedBy) {
      const [user] = await this.users.findMany({
        where: { id: { eq: row.connectedBy } },
        limit: 1,
      });
      connectedBy = {
        id: row.connectedBy,
        ...(user ? { name: displayName(user) } : {}),
      };
    }
    const fullName = `${row.owner}/${row.name}`;
    return {
      repositoryId: row.repositoryId,
      installationId: row.installationId,
      owner: row.owner,
      name: row.name,
      fullName,
      url: `https://github.com/${fullName}`,
      defaultBranch: row.defaultBranch,
      connected: !row.disconnectedAt,
      connectedAt: row.connectedAt,
      ...(row.disconnectedAt ? { disconnectedAt: row.disconnectedAt } : {}),
      ...(row.disconnectReason
        ? { disconnectReason: row.disconnectReason }
        : {}),
      ...(connectedBy ? { connectedBy } : {}),
    };
  }
}
