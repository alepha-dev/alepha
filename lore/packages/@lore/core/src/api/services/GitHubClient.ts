import { $inject } from "alepha";
import {
  BadRequestError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
} from "alepha/server";

import { GitHubAppJwt } from "./GitHubAppJwt.ts";
import { GitHubAppService } from "./GitHubAppService.ts";
import { GitHubTransport } from "./GitHubTransport.ts";

/**
 * Who a call is made as: the App itself (a JWT), one installation token, a
 * member's user token from the install callback, or nobody.
 */
export type GitHubAuth =
  | { as: "app" }
  | { as: "token"; token: string }
  | { as: "none" };

/**
 * A repository as Lore keeps it.
 */
export interface GitHubRepository {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  /**
   * Whether the caller may push, when a user token listed it: GitHub's
   * `permissions.push`. Undefined on an installation token's listing.
   */
  push?: boolean;
}

/**
 * GitHub's own answer, with the parsed body.
 */
export interface GitHubAnswer<T = any> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

/**
 * The calls Lore makes to GitHub as the instance's App (#Q4363, epic #E177):
 * a typed `fetch` wrapper over {@link GitHubTransport}, no SDK.
 *
 * Every call carries `X-GitHub-Api-Version`; the rate-limit headers of the
 * last answer are kept on {@link rateLimit}; an error becomes a Lore error
 * whose message is GitHub's (capped) and never a token. A revoked
 * installation or a repository it no longer holds is a 404 that says so,
 * never a 500.
 *
 * Tokens are the caller's: {@link GitHubTokenService} mints and caches the
 * installation ones, the install callback holds its user token for one
 * call.
 */
export class GitHubClient {
  protected readonly apps = $inject(GitHubAppService);
  protected readonly jwt = $inject(GitHubAppJwt);
  protected readonly transport = $inject(GitHubTransport);

  /**
   * What GitHub's last answer said of the rate limit: requests left, and
   * when the window resets (epoch seconds).
   */
  public rateLimit: { remaining?: number; reset?: number } = {};

  async request<T = any>(
    method: string,
    path: string,
    options: {
      auth: GitHubAuth;
      body?: unknown;
      query?: Record<string, string | number | undefined>;
      base?: string;
      accept?: string;
    },
  ): Promise<GitHubAnswer<T>> {
    const url = new URL(`${options.base ?? GitHubAppService.API_BASE}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers = this.apps.headers({
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...(options.accept ? { accept: options.accept } : {}),
    });
    const authorization = await this.authorization(options.auth);
    if (authorization) headers.authorization = authorization;
    const response = await this.transport.send({
      method,
      url: url.toString(),
      headers,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    this.readRateLimit(response.headers);
    const data = this.parse(response.body);
    if (response.status >= 400) {
      throw this.error(response.status, data, response.headers);
    }
    return {
      status: response.status,
      data: data as T,
      headers: response.headers,
    };
  }

  // ---- installations ----------------------------------------------------

  async createInstallationToken(
    installationId: number,
    body: { repository_ids: number[]; permissions: Record<string, string> },
  ): Promise<{
    token: string;
    expiresAt: string;
    permissions: Record<string, string>;
  }> {
    try {
      const answer = await this.request<{
        token: string;
        expires_at: string;
        permissions: Record<string, string>;
      }>("POST", `/app/installations/${installationId}/access_tokens`, {
        auth: { as: "app" },
        body,
      });
      return {
        token: answer.data.token,
        expiresAt: answer.data.expires_at,
        permissions: answer.data.permissions ?? {},
      };
    } catch (error) {
      throw this.installationError(error);
    }
  }

  /**
   * The App as GitHub has it (#Q4561): who owns it, a user or an
   * organization, which decides where its settings page lives.
   */
  async getApp(): Promise<{ ownerLogin?: string; ownerType?: string }> {
    const answer = await this.request("GET", "/app", { auth: { as: "app" } });
    return {
      ownerLogin: this.text(answer.data?.owner?.login, 100) || undefined,
      ownerType: this.text(answer.data?.owner?.type, 32) || undefined,
    };
  }

  async getInstallation(installationId: number): Promise<{
    id: number;
    account?: string;
    suspended: boolean;
  }> {
    try {
      const answer = await this.request(
        "GET",
        `/app/installations/${installationId}`,
        {
          auth: { as: "app" },
        },
      );
      return {
        id: Number(answer.data.id),
        account: this.text(answer.data.account?.login, 100) || undefined,
        suspended: Boolean(answer.data.suspended_at),
      };
    } catch (error) {
      throw this.installationError(error);
    }
  }

  /**
   * The repositories an installation token reaches.
   */
  async listInstallationRepositories(
    token: string,
  ): Promise<GitHubRepository[]> {
    return await this.pages(
      "/installation/repositories",
      { as: "token", token },
      (data) => (data.repositories ?? []).map((r: any) => this.repository(r)),
    );
  }

  /**
   * The repositories of an installation that the user behind `userToken`
   * can reach (#Q4362): the proof the member picks one they can reach.
   */
  async listUserInstallationRepositories(
    userToken: string,
    installationId: number,
  ): Promise<GitHubRepository[]> {
    return await this.pages(
      `/user/installations/${installationId}/repositories`,
      { as: "token", token: userToken },
      (data) => (data.repositories ?? []).map((r: any) => this.repository(r)),
    );
  }

  /**
   * Exchanges the user code of the install callback for a user token
   * (#Q4362), with the App's client id and secret. The token is the
   * caller's, for one call.
   */
  async exchangeUserCode(
    code: string,
  ): Promise<{ token: string; userId?: number }> {
    const app = await this.apps.require();
    const answer = await this.request<{
      access_token?: string;
      error?: string;
    }>("POST", "/login/oauth/access_token", {
      auth: { as: "none" },
      base: "https://github.com",
      accept: "application/json",
      body: {
        client_id: app.clientId,
        client_secret: app.clientSecret,
        code,
      },
    });
    const token = answer.data.access_token;
    if (!token) {
      throw new BadRequestError(
        "GitHub refused the authorization code: install again from Lore",
      );
    }
    let userId: number | undefined;
    try {
      const user = await this.request("GET", "/user", {
        auth: { as: "token", token },
      });
      userId = Number(user.data.id) || undefined;
    } catch {
      userId = undefined;
    }
    return { token, userId };
  }

  // ---- repositories -----------------------------------------------------

  async getRepository(
    token: string,
    repositoryId: number,
  ): Promise<GitHubRepository> {
    const answer = await this.request("GET", `/repositories/${repositoryId}`, {
      auth: { as: "token", token },
    });
    return this.repository(answer.data);
  }

  async listPullRequests(
    token: string,
    repo: { owner: string; name: string },
    query: {
      state: "open" | "closed" | "all";
      sort?: string;
      direction?: string;
    },
    limit = 100,
  ): Promise<any[]> {
    return await this.pages(
      `/repos/${this.slug(repo)}/pulls`,
      { as: "token", token },
      (data) => (Array.isArray(data) ? data : []),
      { ...query },
      limit,
    );
  }

  async getPullRequest(
    token: string,
    repo: { owner: string; name: string },
    number: number,
  ): Promise<any> {
    return (
      await this.request("GET", `/repos/${this.slug(repo)}/pulls/${number}`, {
        auth: { as: "token", token },
      })
    ).data;
  }

  /**
   * A user's permission on the repository: `admin`, `maintain`, `write`,
   * `triage`, `read` or `none`.
   */
  async getCollaboratorPermission(
    token: string,
    repo: { owner: string; name: string },
    login: string,
  ): Promise<string> {
    try {
      const answer = await this.request(
        "GET",
        `/repos/${this.slug(repo)}/collaborators/${encodeURIComponent(login)}/permission`,
        { auth: { as: "token", token } },
      );
      return (
        // `permission` is the base level (admin, write, read, none) a custom
        // role maps to; `role_name` would name the custom role itself.
        this.text(answer.data.permission ?? answer.data.role_name, 20) || "none"
      );
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return "none";
      throw error;
    }
  }

  async listCheckRuns(
    token: string,
    repo: { owner: string; name: string },
    ref: string,
  ): Promise<any[]> {
    return await this.pages(
      `/repos/${this.slug(repo)}/commits/${encodeURIComponent(ref)}/check-runs`,
      { as: "token", token },
      (data) => data.check_runs ?? [],
    );
  }

  async listCheckSuites(
    token: string,
    repo: { owner: string; name: string },
    ref: string,
  ): Promise<any[]> {
    return await this.pages(
      `/repos/${this.slug(repo)}/commits/${encodeURIComponent(ref)}/check-suites`,
      { as: "token", token },
      (data) => data.check_suites ?? [],
    );
  }

  async listCommitStatuses(
    token: string,
    repo: { owner: string; name: string },
    ref: string,
  ): Promise<any[]> {
    return await this.pages(
      `/repos/${this.slug(repo)}/commits/${encodeURIComponent(ref)}/statuses`,
      { as: "token", token },
      (data) => (Array.isArray(data) ? data : []),
    );
  }

  // ---- workflows --------------------------------------------------------

  async listWorkflows(
    token: string,
    repo: { owner: string; name: string },
  ): Promise<any[]> {
    return await this.pages(
      `/repos/${this.slug(repo)}/actions/workflows`,
      { as: "token", token },
      (data) => data.workflows ?? [],
    );
  }

  /**
   * A file's text at a ref, or undefined when it is not there.
   */
  async getFileText(
    token: string,
    repo: { owner: string; name: string },
    path: string,
    ref?: string,
  ): Promise<string | undefined> {
    try {
      const answer = await this.request(
        "GET",
        `/repos/${this.slug(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
        { auth: { as: "token", token }, query: { ref } },
      );
      if (typeof answer.data.content !== "string") return undefined;
      const binary = atob(answer.data.content.replace(/\s+/g, ""));
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return undefined;
      throw error;
    }
  }

  async dispatchWorkflow(
    token: string,
    repo: { owner: string; name: string },
    workflowId: number,
    body: { ref: string; inputs?: Record<string, string> },
  ): Promise<void> {
    await this.request(
      "POST",
      `/repos/${this.slug(repo)}/actions/workflows/${workflowId}/dispatches`,
      { auth: { as: "token", token }, body },
    );
  }

  async listWorkflowRuns(
    token: string,
    repo: { owner: string; name: string },
    query: { workflowId?: number; per_page?: number } = {},
  ): Promise<any[]> {
    const path =
      query.workflowId !== undefined
        ? `/repos/${this.slug(repo)}/actions/workflows/${query.workflowId}/runs`
        : `/repos/${this.slug(repo)}/actions/runs`;
    const answer = await this.request("GET", path, {
      auth: { as: "token", token },
      query: { per_page: query.per_page ?? 20 },
    });
    return answer.data.workflow_runs ?? [];
  }

  async rerunWorkflowRun(
    token: string,
    repo: { owner: string; name: string },
    runId: number,
    failedOnly: boolean,
  ): Promise<void> {
    await this.request(
      "POST",
      `/repos/${this.slug(repo)}/actions/runs/${runId}/${failedOnly ? "rerun-failed-jobs" : "rerun"}`,
      { auth: { as: "token", token } },
    );
  }

  async cancelWorkflowRun(
    token: string,
    repo: { owner: string; name: string },
    runId: number,
  ): Promise<void> {
    await this.request(
      "POST",
      `/repos/${this.slug(repo)}/actions/runs/${runId}/cancel`,
      {
        auth: { as: "token", token },
      },
    );
  }

  // ---- the App's hook deliveries ---------------------------------------

  /**
   * One page of the App's recent deliveries, newest first, and the cursor of
   * the next one.
   */
  async listHookDeliveries(cursor?: string): Promise<{
    deliveries: Array<{
      id: number;
      guid: string;
      status_code: number;
      delivered_at: string;
      redelivery: boolean;
    }>;
    next?: string;
  }> {
    const answer = await this.request("GET", "/app/hook/deliveries", {
      auth: { as: "app" },
      query: { per_page: 100, cursor },
    });
    const link = answer.headers.link ?? "";
    const next = /[?&]cursor=([^&>]+)[^>]*>;\s*rel="next"/.exec(link)?.[1];
    return {
      deliveries: Array.isArray(answer.data) ? answer.data : [],
      ...(next ? { next: decodeURIComponent(next) } : {}),
    };
  }

  async redeliverHookDelivery(deliveryId: number): Promise<void> {
    await this.request("POST", `/app/hook/deliveries/${deliveryId}/attempts`, {
      auth: { as: "app" },
    });
  }

  async getUserId(login: string): Promise<number | undefined> {
    try {
      const answer = await this.request(
        "GET",
        `/users/${encodeURIComponent(login)}`,
        {
          auth: { as: "none" },
        },
      );
      return Number(answer.data.id) || undefined;
    } catch {
      return undefined;
    }
  }

  // ---- helpers ----------------------------------------------------------

  repository(data: any): GitHubRepository {
    const owner = this.text(data?.owner?.login, 100);
    const name = this.text(data?.name, 100);
    return {
      id: Number(data?.id),
      owner,
      name,
      fullName: `${owner}/${name}`,
      defaultBranch: this.text(data?.default_branch, 255) || "main",
      private: Boolean(data?.private),
      ...(typeof data?.permissions?.push === "boolean"
        ? { push: data.permissions.push }
        : {}),
    };
  }

  /**
   * A text field from GitHub, as data: a string, capped, or empty.
   */
  text(value: unknown, max: number): string {
    return typeof value === "string" ? value.slice(0, max) : "";
  }

  protected slug(repo: { owner: string; name: string }): string {
    return `${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  }

  /**
   * Reads every page of a list (100 a page), up to `limit` items.
   */
  protected async pages<T>(
    path: string,
    auth: GitHubAuth,
    items: (data: any) => T[],
    query: Record<string, string | number | undefined> = {},
    limit = 1000,
  ): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; out.length < limit && page <= 20; page++) {
      const answer = await this.request("GET", path, {
        auth,
        query: { ...query, per_page: 100, page },
      });
      const batch = items(answer.data);
      out.push(...batch);
      if (batch.length < 100 || !/rel="next"/.test(answer.headers.link ?? "")) {
        break;
      }
    }
    return out.slice(0, limit);
  }

  protected async authorization(auth: GitHubAuth): Promise<string | undefined> {
    if (auth.as === "none") return undefined;
    if (auth.as === "token") return `Bearer ${auth.token}`;
    const app = await this.apps.require();
    return `Bearer ${await this.jwt.sign(app.appId, app.privateKey)}`;
  }

  protected readRateLimit(headers: Record<string, string>): void {
    const remaining = Number(headers["x-ratelimit-remaining"]);
    const reset = Number(headers["x-ratelimit-reset"]);
    if (Number.isFinite(remaining)) this.rateLimit.remaining = remaining;
    if (Number.isFinite(reset)) this.rateLimit.reset = reset;
  }

  protected parse(body: string): any {
    if (!body) return {};
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }

  /**
   * GitHub's refusal as a Lore error. GitHub's own message is kept, capped,
   * since it is what tells an operator what to fix; a token never is, since
   * none is ever in an answer body.
   */
  protected error(
    status: number,
    data: any,
    headers: Record<string, string>,
  ): Error {
    const said = this.text(data?.message, 200);
    const message = `GitHub answered ${status}${said ? `: ${said}` : ""}`;
    if (
      status === 429 ||
      (status === 403 && headers["x-ratelimit-remaining"] === "0")
    ) {
      return new TooManyRequestsError(
        `GitHub's rate limit is reached: ${said || "try again later"}`,
      );
    }
    if (status === 404) return new NotFoundError(message);
    if (status === 401 || status === 403) return new ForbiddenError(message);
    if (status === 422) return new HttpError({ status: 422 }, { message });
    if (status === 400) return new BadRequestError(message);
    return new ServiceUnavailableError(message);
  }

  /**
   * A refusal on an installation call, said as what it means.
   */
  protected installationError(error: unknown): unknown {
    if (!(error instanceof HttpError)) return error;
    if (error.status === 404) {
      return new NotFoundError(
        "The GitHub App is no longer installed there: connect the repository again",
      );
    }
    if (error.status === 422) {
      return new NotFoundError(
        "The GitHub App's installation no longer holds this repository: add it to the installation, or connect again",
      );
    }
    if (error.status === 403) {
      return new ForbiddenError(
        "The GitHub App's installation is suspended, or does not grant what was asked",
      );
    }
    return error;
  }
}
