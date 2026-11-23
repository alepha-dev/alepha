import { JobKeyService, ProjectSecurityService } from "@lore/core/api";
import { $inject } from "alepha";
import { SecurityProvider, type UserAccountToken } from "alepha/security";

import type { GitService } from "../backends/GitBackend.ts";
import type { CodeRepository } from "../entities/codeRepositories.ts";
import { CodeRepositoryService } from "./CodeRepositoryService.ts";

/**
 * Who may clone or push a repository over smart HTTP (#Q3932).
 *
 * git sends HTTP Basic, and Lore's resolvers read only `Authorization:
 * Bearer` (and `?api_key=`). So the password, whatever the username, is
 * handed to them as a bearer: an API key (`ak_...`) or an OAuth access
 * token, which is what the `lore` credential helper answers with.
 *
 * The order is the rule:
 *
 * 1. No credential, or one no resolver takes: **401 with
 *    `WWW-Authenticate`**, before any lookup, so git asks its credential
 *    helper and a stranger learns nothing.
 * 2. No such project, or the caller is not a member: 404, never 403, which
 *    would confirm the project exists.
 * 3. A member without `code:read` (clone) or `code:write` (push), in the
 *    token's scope or the rank: 403.
 * 4. Build off: 404 on a read, 400 on a write, as every capability gate.
 * 5. No such repository: 404.
 */
export class GitAccessService {
  protected readonly security = $inject(SecurityProvider);
  protected readonly projectSecurity = $inject(ProjectSecurityService);
  protected readonly repositories = $inject(CodeRepositoryService);
  protected readonly jobKeys = $inject(JobKeyService);

  public async authorize(input: {
    authorization?: string;
    url: URL;
    projectSlug: string;
    repoSlug: string;
    service: GitService;
  }): Promise<GitAccessDecision> {
    const secret = this.passwordOf(input.authorization);
    if (!secret) {
      return {
        allowed: false,
        status: 401,
        message: "Authentication required",
      };
    }
    const user = await this.security
      .resolveUserFromServerRequest({
        url: input.url,
        headers: { authorization: `Bearer ${secret}` },
      })
      .catch(() => undefined);
    if (!user) {
      return {
        allowed: false,
        status: 401,
        message:
          "Invalid credentials: use a Lore API key or `lore git-credential`",
      };
    }
    const notFound: GitAccessDecision = {
      allowed: false,
      status: 404,
      message: "Repository not found",
    };
    const project = await this.projectSecurity.projects.findOne({
      where: { slug: { eq: input.projectSlug } },
    });
    if (!project) return notFound;
    const permissions = await this.projectSecurity.permissionsIn(
      project.id,
      user.id,
    );
    if (permissions === undefined) return notFound;
    const write = input.service === "git-receive-pack";
    const permission = write ? "code:write" : "code:read";
    const scoped = this.security.checkUserPermission(user, permission);
    const ranked = await this.projectSecurity.holds(
      project.id,
      user.id,
      permission,
    );
    if (!scoped.isAuthorized || !ranked) {
      return {
        allowed: false,
        status: 403,
        message: `${write ? "Pushing" : "Cloning"} needs ${permission}`,
      };
    }
    const capabilities = await this.projectSecurity.capabilitiesOf(project.id);
    // Repositories is an option of Build since #Q4005: git hosting needs it.
    if (
      !this.projectSecurity.capabilityOption(
        capabilities,
        "build",
        "repositories",
      )
    ) {
      return write
        ? {
            allowed: false,
            status: 400,
            message:
              "Cannot push: this project does not have Build with repositories on (build.repositories). Turn it on in Settings.",
          }
        : notFound;
    }
    const row = await this.repositories.find(project.id, input.repoSlug);
    if (!row) return notFound;
    // A job key reaches Lore's MCP only (#Q4222): the route guard refuses
    // it on git before it is resolved, and this is the floor under it.
    if (await this.jobKeys.scopeOf(user)) {
      return notFound;
    }
    return { allowed: true, repository: row, user };
  }

  /**
   * The password of an HTTP Basic header, or undefined.
   */
  protected passwordOf(authorization?: string): string | undefined {
    const match = /^Basic\s+(\S+)$/i.exec(authorization ?? "");
    if (!match?.[1]) return undefined;
    let decoded: string;
    try {
      decoded = atob(match[1]);
    } catch {
      return undefined;
    }
    const colon = decoded.indexOf(":");
    const password = colon === -1 ? "" : decoded.slice(colon + 1);
    return password || undefined;
  }
}

export type GitAccessDecision =
  | {
      allowed: true;
      repository: CodeRepository;
      user: UserAccountToken;
    }
  | { allowed: false; status: 400 | 401 | 403 | 404; message: string };
