import { ProjectCapabilityController, ProjectController } from "@lore/core/api";
import { CapabilityRegistry } from "@lore/core/schemas";
import { CoreTestEntities } from "@lore/core/testing";
import { Alepha } from "alepha";
import { ApiKeyController } from "alepha/api/keys";
import { OrganizationRankController } from "alepha/api/organizations";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm, DatabaseProvider } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";

import { bootLore } from "./bootLore.ts";
import { D1CeilingProvider } from "./D1CeilingProvider.ts";
import { MEMORY_READS } from "./memoryReads.ts";

/**
 * A project for Plan's Requirements scenarios (#E153): every capability on,
 * Plan with `epics`, `releases` and `requirements`, Ship with `track`, an owner, a way to seat
 * a member or a viewer, and an MCP caller with an API key. Over HTTP, with
 * real tokens, as `viewer-reads.spec.ts` does.
 */
export const requirementsProject = async (
  options: {
    requirements?: boolean;
    plan?: Record<string, boolean>;
    /**
     * Classes to construct before `start()`: a spec's repository probe.
     */
    probes?: Array<new () => object>;
    /**
     * Refuse a statement binding over 100 values, as D1 does (#Q3959).
     */
    d1?: boolean;
  } = {},
) => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  if (options.d1) {
    alepha.with({ provide: DatabaseProvider, use: D1CeilingProvider });
  }
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaMcp);
  bootLore(alepha, ["api", "mcp"]);
  const repos = alepha.inject(CoreTestEntities);
  for (const probe of options.probes ?? []) alepha.inject(probe);
  await alepha.start();

  const baseUrl = alepha.inject(NodeHttpServerProvider).hostname;
  const users = alepha.inject(UserService);
  const projects = alepha.inject(ProjectController);
  const rankApi = alepha.inject(OrganizationRankController);
  const keys = alepha.inject(ApiKeyController);
  const capabilityApi = alepha.inject(ProjectCapabilityController);
  const capabilities = alepha.inject(CapabilityRegistry);

  const as = (id: string) =>
    ({ user: { id, roles: ["user"], realm: "users" } }) as never;

  const person = async (name: string) =>
    (await users.createUser({ username: name, email: `${name}@example.com` }))
      .id;

  const planOptions = {
    epics: true,
    releases: true,
    requirements: options.requirements ?? true,
    ...options.plan,
  };

  const owner = await person("owner");
  const created = await projects.createProject.fetch(
    {
      body: {
        title: "Acme",
        capabilities: capabilities
          .all()
          .map((it) =>
            it.key === "plan"
              ? { key: it.key, options: planOptions }
              : it.key === "ship"
                ? { key: it.key, options: { track: true } }
                : { key: it.key },
          ),
      } as never,
    },
    as(owner),
  );
  const projectId = created.data.id;
  const organizationId = (await repos.projects.findById(projectId))!
    .organizationId!;

  await rankApi.saveOrganizationRank.fetch(
    {
      params: { organizationId, key: "peek" },
      body: { name: "peek", permissions: [...MEMORY_READS] },
    },
    as(owner),
  );

  /**
   * A new user in the project, at `rank` (`member` by default, `peek` for
   * the Viewer allowlist).
   */
  const seat = async (name: string, rank = "member") => {
    const id = await person(name);
    await repos.members.create({ organizationId, userId: id });
    await rankApi.assignOrganizationRank.fetch(
      { params: { organizationId, userId: id }, body: { key: rank } },
      as(owner),
    );
    return id;
  };

  /**
   * Turn Plan's options to `next`, whole.
   */
  const setPlan = async (next: Record<string, boolean>) =>
    await capabilityApi.setCapability.fetch(
      {
        params: { projectId, key: "plan" },
        body: { enabled: true, options: next },
      },
      as(owner),
    );

  const statusOf = async (call: Promise<unknown>) => {
    try {
      await call;
      return 200;
    } catch (error) {
      return (error as { status?: number }).status ?? 0;
    }
  };

  const tokenOf = async (id: string) =>
    (
      await keys.createApiKey.fetch({ body: { name: "spec" } }, {
        user: { id, roles: ["user"], realm: "users" },
      } as never)
    ).data.token;

  const mcp = async (
    token: string,
    name: string,
    args: Record<string, unknown>,
  ) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: { project: projectId, ...args } },
      }),
    });
    const data = (await response.json()) as {
      error?: { message: string };
      result?: {
        isError?: boolean;
        content?: Array<{ text: string }>;
        structuredContent?: any;
      };
    };
    const text = data.error?.message ?? data.result?.content?.[0]?.text ?? "";
    let json: any;
    try {
      json = data.result?.structuredContent ?? JSON.parse(text);
    } catch {
      json = undefined;
    }
    return {
      refused: !!data.error || data.result?.isError === true,
      text,
      json,
    };
  };

  return {
    alepha,
    repos,
    as,
    seat,
    setPlan,
    planOptions,
    statusOf,
    tokenOf,
    mcp,
    owner,
    projectId,
    organizationId,
  };
};

export type RequirementsProject = Awaited<
  ReturnType<typeof requirementsProject>
>;
