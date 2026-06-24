import { $inject, Alepha, AlephaError, type TSchema, z } from "alepha";
import { $logger } from "alepha/logger";
import type {
  VercelDeployment,
  VercelEnvVar,
  VercelProject,
} from "../schemas/vercel.ts";
import {
  createEnvVarBodySchema,
  createProjectBodySchema,
  vercelDeploymentSchema,
  vercelEnvVarSchema,
  vercelProjectSchema,
} from "../schemas/vercel.ts";
import { VercelCli } from "./VercelCli.ts";

/**
 * Thin wrapper over the Vercel REST API.
 *
 * Uses the auth token from VercelCli for all requests.
 */
export class VercelApi {
  protected static readonly BASE = "https://api.vercel.com";

  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly vercelCli = $inject(VercelCli);

  protected token?: string;

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  /**
   * Obtain the current auth token from the Vercel CLI.
   */
  public async resolveToken(): Promise<string> {
    if (this.token) {
      return this.token;
    }

    this.token = await this.vercelCli.getAuthToken();
    return this.token;
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  public async listProjects(): Promise<VercelProject[]> {
    const res = await this.fetch<{ projects: VercelProject[] }>(
      "/v10/projects",
      { schema: z.object({ projects: z.array(vercelProjectSchema) }) },
    );
    return res.projects;
  }

  public async getProject(
    nameOrId: string,
  ): Promise<VercelProject | undefined> {
    try {
      return await this.fetch<VercelProject>(
        `/v9/projects/${encodeURIComponent(nameOrId)}`,
        { schema: vercelProjectSchema },
      );
    } catch {
      return undefined;
    }
  }

  public async createProject(name: string): Promise<VercelProject> {
    return await this.fetch<VercelProject>("/v11/projects", {
      method: "POST",
      body: { name, framework: null },
      bodySchema: createProjectBodySchema,
      schema: vercelProjectSchema,
    });
  }

  public async updateProject(
    nameOrId: string,
    settings: { framework?: null },
  ): Promise<void> {
    await this.fetch(`/v9/projects/${encodeURIComponent(nameOrId)}`, {
      method: "PATCH",
      body: settings,
    });
  }

  public async deleteProject(nameOrId: string): Promise<void> {
    await this.fetch(`/v9/projects/${encodeURIComponent(nameOrId)}`, {
      method: "DELETE",
    });
  }

  // -------------------------------------------------------------------------
  // Deployments
  // -------------------------------------------------------------------------

  public async listDeployments(
    projectId: string,
    options?: { limit?: number; target?: string },
  ): Promise<VercelDeployment[]> {
    const query: Record<string, string> = { projectId };
    if (options?.limit) {
      query.limit = String(options.limit);
    }
    if (options?.target) {
      query.target = options.target;
    }

    const res = await this.fetch<{ deployments: VercelDeployment[] }>(
      "/v6/deployments",
      {
        query,
        schema: z.object({ deployments: z.array(vercelDeploymentSchema) }),
      },
    );
    return res.deployments;
  }

  // -------------------------------------------------------------------------
  // Environment Variables
  // -------------------------------------------------------------------------

  public async listEnvVars(projectId: string): Promise<VercelEnvVar[]> {
    const res = await this.fetch<{ envs: VercelEnvVar[] }>(
      `/v10/projects/${encodeURIComponent(projectId)}/env`,
      {
        query: { decrypt: "true" },
        schema: z.object({ envs: z.array(vercelEnvVarSchema) }),
      },
    );
    return res.envs;
  }

  public async upsertEnvVars(
    projectId: string,
    vars: Array<{
      key: string;
      value: string;
      target: string[];
    }>,
  ): Promise<void> {
    for (const v of vars) {
      await this.fetch(`/v10/projects/${encodeURIComponent(projectId)}/env`, {
        method: "POST",
        query: { upsert: "true" },
        body: {
          key: v.key,
          value: v.value,
          type: "encrypted",
          target: v.target,
        },
        bodySchema: createEnvVarBodySchema,
      });
    }
  }

  public async deleteEnvVar(
    projectId: string,
    envVarId: string,
  ): Promise<void> {
    await this.fetch(
      `/v9/projects/${encodeURIComponent(projectId)}/env/${envVarId}`,
      { method: "DELETE" },
    );
  }

  // -------------------------------------------------------------------------
  // Core fetch
  // -------------------------------------------------------------------------

  protected async fetch<T = unknown>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      bodySchema?: TSchema;
      schema?: TSchema;
      query?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const token = await this.resolveToken();
    const { method = "GET", body, query } = options;

    let url = `${VercelApi.BASE}${path}`;
    if (query) {
      const params = new URLSearchParams(query);
      url += `?${params.toString()}`;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    const init: RequestInit = { method, headers };

    if (body) {
      headers["Content-Type"] = "application/json";
      const validated = options.bodySchema
        ? this.alepha.codec.validate(options.bodySchema, body)
        : body;
      init.body = JSON.stringify(validated);
    }

    const response = await globalThis.fetch(url, init);

    // DELETE returns 204 with no body
    if (response.status === 204) {
      return undefined as T;
    }

    const json = await response.json();

    // Vercel error format: { error: { message, code } }
    if (json.error) {
      throw new AlephaError(
        `Vercel API error (${method} ${path}): ${json.error.message ?? JSON.stringify(json.error)}`,
      );
    }

    if (!response.ok) {
      throw new AlephaError(
        `Vercel API error (${method} ${path}): HTTP ${response.status}`,
      );
    }

    if (options.schema) {
      return this.alepha.codec.validate(options.schema, json) as T;
    }

    return json as T;
  }
}
