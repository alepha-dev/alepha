import { generateKeyPairSync } from "node:crypto";

import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { ProjectGitHubController } from "../src/api/controllers/ProjectGitHubController.ts";
import { githubStates } from "../src/api/entities/githubStates.ts";
import { projectRepositories } from "../src/api/entities/projectRepositories.ts";
import { projects } from "../src/api/entities/projects.ts";
import { LoreCoreApi } from "../src/api/index.ts";
import { GitHubTransport } from "../src/api/services/GitHubTransport.ts";
import { ProjectRepositoryService } from "../src/api/services/ProjectRepositoryService.ts";
import {
  CoreTestEntities,
  createTestMember,
  createTestProject,
} from "../src/testing/entities.ts";
import { MemoryGitHubTransport } from "../src/testing/MemoryGitHubTransport.ts";
import { createPresetRanks } from "../src/testing/presetRanks.ts";

class Rows {
  repositories = $repository(projectRepositories);
  states = $repository(githubStates);
  projects = $repository(projects);
}

const pkcs1 = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

const USER_TOKEN = "ghu_member_user_token_value";

const repo = (id: number, owner: string, name: string, push = true) => ({
  id,
  name,
  owner: { login: owner },
  default_branch: "main",
  private: true,
  permissions: { push },
});

/**
 * Installation 7 holds acme/web (101) and acme/api (102); installation 8
 * holds acme/solo (201). The member's user token reaches acme/web and
 * acme/api through installation 7, acme/solo through 8.
 */
const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      APP_SECRET: "a-strong-unique-secret-for-the-github-connect-spec",
      PUBLIC_URL: "https://lore.example.app",
      GITHUB_APP_ID: "4242",
      GITHUB_APP_SLUG: "lore-acme",
      GITHUB_APP_CLIENT_ID: "Iv1.acme",
      GITHUB_APP_CLIENT_SECRET: "client-secret",
      GITHUB_APP_WEBHOOK_SECRET: "webhook-secret",
      GITHUB_APP_PRIVATE_KEY: pkcs1,
    },
  });
  alepha.with({ provide: GitHubTransport, use: MemoryGitHubTransport });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreCoreApi);
  alepha.inject(CoreTestEntities);
  const rows = alepha.inject(Rows);
  await alepha.start();

  const github = alepha.inject(MemoryGitHubTransport);
  const holds: Record<string, ReturnType<typeof repo>[]> = {
    "7": [repo(101, "acme", "web"), repo(102, "acme", "api")],
    "8": [repo(201, "acme", "solo")],
  };
  github.on("POST", /^\/login\/oauth\/access_token$/, (request) =>
    JSON.parse(request.body ?? "{}").code === "good"
      ? { json: { access_token: USER_TOKEN, token_type: "bearer" } }
      : { json: { error: "bad_verification_code" } },
  );
  github.on("GET", /^\/user$/, { json: { id: 9001, login: "member" } });
  github.on("GET", /^\/user\/installations\/(\d+)\/repositories$/, (_r, m) => ({
    json: {
      total_count: holds[m[1]]?.length ?? 0,
      repositories: holds[m[1]] ?? [],
    },
  }));
  github.on(
    "POST",
    /^\/app\/installations\/(\d+)\/access_tokens$/,
    (_r, m) => ({
      status: 201,
      json: {
        token: `ghs_installation_${m[1]}`,
        expires_at: "2099-01-01T00:00:00Z",
        permissions: {},
      },
    }),
  );
  github.on("GET", /^\/repositories\/(\d+)$/, (request, m) => {
    const installation = /ghs_installation_(\d+)/.exec(
      request.headers?.authorization ?? "",
    )?.[1];
    const found = (holds[installation ?? ""] ?? []).find(
      (it) => String(it.id) === m[1],
    );
    return found
      ? { json: found }
      : { status: 404, json: { message: "Not Found" } };
  });

  const project = await createTestProject(alepha, { title: "Acme web" });
  const other = await createTestProject(alepha, { title: "Acme other" });
  const owner = { id: project.createdBy!, roles: ["user"] };
  const otherOwner = { id: other.createdBy!, roles: ["user"] };
  const api = alepha.inject(ProjectGitHubController);
  const service = alepha.inject(ProjectRepositoryService);
  return {
    alepha,
    rows,
    github,
    holds,
    project,
    other,
    owner,
    otherOwner,
    api,
    service,
  };
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const install = async (
  ctx: Ctx,
  projectId = ctx.project.id,
  user = ctx.owner,
) => {
  const link = await ctx.api.getProjectGitHubInstallLink.fetch(
    { params: { projectId } },
    { user },
  );
  const url = new URL(link.data.url);
  if (
    url.origin + url.pathname !==
    "https://github.com/apps/lore-acme/installations/new"
  ) {
    throw new Error(`Not the install page: ${url}`);
  }
  return url.searchParams.get("state")!;
};

const back = (ctx: Ctx, body: Record<string, unknown>, user = ctx.owner) =>
  ctx.api.completeGitHubInstall.fetch({ body: body as any }, { user });

describe("connecting a project to its GitHub repository", () => {
  it("connects at once when the installation holds one repository the member reaches", async ({
    expect,
  }) => {
    const ctx = await setup();
    const state = await install(ctx);
    const result = (
      await back(ctx, {
        state,
        code: "good",
        installationId: 8,
        setupAction: "install",
      })
    ).data;
    expect(result).toMatchObject({
      outcome: "connected",
      projectId: ctx.project.id,
      connection: {
        repositoryId: 201,
        installationId: 8,
        fullName: "acme/solo",
        defaultBranch: "main",
        connected: true,
      },
    });
    const [row] = await ctx.rows.repositories.findMany({});
    expect(row.connectedByGithubId).toBe(9001);
    // One source of truth: the project's URL is the repository's.
    const project = await ctx.rows.projects.findById(ctx.project.id);
    expect(project!.repositoryUrl).toBe("https://github.com/acme/solo");
    // ...which a hand edit no longer changes.
    await expect(
      ctx.alepha.inject(ProjectController).updateProjectById.fetch(
        {
          params: { id: ctx.project.id },
          body: { repositoryUrl: "https://github.com/acme/elsewhere" },
        },
        { user: ctx.owner },
      ),
    ).rejects.toThrow(/connected to GitHub/);
  });

  it("offers the repositories the member reaches, and connects the one picked, never another", async ({
    expect,
  }) => {
    const ctx = await setup();
    const state = await install(ctx);
    const result = (await back(ctx, { state, code: "good", installationId: 7 }))
      .data;
    expect(result.outcome).toBe("choose");
    expect(result.repositories?.map((it) => it.fullName)).toEqual([
      "acme/web",
      "acme/api",
    ]);

    await expect(
      ctx.api.connectProjectGitHub.fetch(
        {
          params: { projectId: ctx.project.id },
          body: { pick: result.pick!, repositoryId: 201 },
        },
        { user: ctx.owner },
      ),
    ).rejects.toThrow(/not among the ones your GitHub account reaches/);

    const state2 = await install(ctx);
    const again = (
      await back(ctx, { state: state2, code: "good", installationId: 7 })
    ).data;
    const connection = (
      await ctx.api.connectProjectGitHub.fetch(
        {
          params: { projectId: ctx.project.id },
          body: { pick: again.pick!, repositoryId: 102 },
        },
        { user: ctx.owner },
      )
    ).data;
    expect(connection.fullName).toBe("acme/api");
  });

  it("connects only a repository the member can push to on GitHub", async ({
    expect,
  }) => {
    const ctx = await setup();
    // Read access only: Lore would give that member pushes and workflows.
    ctx.holds["8"] = [repo(201, "acme", "solo", false)];
    const state = await install(ctx);
    await expect(
      back(ctx, {
        state,
        code: "good",
        installationId: 8,
        setupAction: "install",
      }),
    ).rejects.toThrow("can push to no repository");
    expect(await ctx.rows.repositories.findMany({})).toHaveLength(0);
  });

  it("uses the user token once and stores it nowhere", async ({ expect }) => {
    const ctx = await setup();
    const state = await install(ctx);
    await back(ctx, { state, code: "good", installationId: 7 });
    const stored = JSON.stringify([
      await ctx.rows.repositories.findMany({}),
      await ctx.rows.states.findMany({}),
    ]);
    expect(stored).not.toContain(USER_TOKEN);
    const withUserToken = ctx.github.requests.filter((request) =>
      request.headers?.authorization?.includes(USER_TOKEN),
    );
    expect(
      withUserToken.map((request) => new URL(request.url).pathname),
    ).toEqual(["/user", "/user/installations/7/repositories"]);
  });

  it("refuses a forged, a replayed or another member's callback", async ({
    expect,
  }) => {
    const ctx = await setup();
    const state = await install(ctx);
    await expect(
      back(ctx, { state: `${state}x`, code: "good", installationId: 8 }),
    ).rejects.toThrow(/expired or was already used/);
    await expect(
      back(ctx, { state, code: "good", installationId: 8 }, ctx.otherOwner),
    ).rejects.toThrow(/expired or was already used/);
    // An installation id alone attaches nothing.
    await expect(back(ctx, { state: "", installationId: 8 })).rejects.toThrow();
    await back(ctx, { state, code: "good", installationId: 8 });
    await expect(
      back(ctx, { state, code: "good", installationId: 8 }),
    ).rejects.toThrow(/expired or was already used/);
  });

  it("refuses a member whose rank cannot edit the project", async ({
    expect,
  }) => {
    const ctx = await setup();
    await createPresetRanks(ctx.alepha, ctx.project.id);
    const viewer = await CoreTestEntities.of(ctx.alepha).users.create({});
    await createTestMember(ctx.alepha, ctx.project, viewer.id, {
      rank: "viewer",
    });
    await expect(
      ctx.api.getProjectGitHubInstallLink.fetch(
        { params: { projectId: ctx.project.id } },
        { user: { id: viewer.id, roles: ["user"] } },
      ),
    ).rejects.toThrow();
  });

  it("refuses a repository the installation does not hold, or that the user token cannot see", async ({
    expect,
  }) => {
    const ctx = await setup();
    // The member reaches nothing in installation 9.
    const state = await install(ctx);
    await expect(
      back(ctx, { state, code: "good", installationId: 9 }),
    ).rejects.toThrow(/can push to no repository/);

    // The CLI's path cannot name an installation no member connected through.
    await expect(
      ctx.api.connectProjectGitHub.fetch(
        {
          params: { projectId: ctx.project.id },
          body: { installationId: 7, repositoryId: 101 },
        },
        { user: ctx.owner },
      ),
    ).rejects.toThrow(/No member of this project connected/);
  });

  it("keeps nothing for a request an organization owner must approve", async ({
    expect,
  }) => {
    const ctx = await setup();
    const state = await install(ctx);
    const result = (await back(ctx, { state, setupAction: "request" })).data;
    expect(result.outcome).toBe("requested");
    expect(await ctx.rows.repositories.count()).toBe(0);
  });

  it("refuses a repository already connected to another project, saying why", async ({
    expect,
  }) => {
    const ctx = await setup();
    await back(ctx, {
      state: await install(ctx),
      code: "good",
      installationId: 8,
    });
    const state = await install(ctx, ctx.other.id, ctx.otherOwner);
    await expect(
      back(ctx, { state, code: "good", installationId: 8 }, ctx.otherOwner),
    ).rejects.toThrow(
      /acme\/solo is already connected to another Lore project/,
    );

    // Disconnected there, it can move.
    await ctx.api.disconnectProjectGitHub.fetch(
      { params: { projectId: ctx.project.id } },
      { user: ctx.owner },
    );
    const moved = (
      await back(
        ctx,
        {
          state: await install(ctx, ctx.other.id, ctx.otherOwner),
          code: "good",
          installationId: 8,
        },
        ctx.otherOwner,
      )
    ).data;
    expect(moved.outcome).toBe("connected");
    expect(await ctx.rows.repositories.count()).toBe(1);
  });

  it("lets the CLI connect through an installation a member already connected through", async ({
    expect,
  }) => {
    const ctx = await setup();
    const state = await install(ctx);
    const result = (await back(ctx, { state, code: "good", installationId: 7 }))
      .data;
    await ctx.api.connectProjectGitHub.fetch(
      {
        params: { projectId: ctx.project.id },
        body: { pick: result.pick!, repositoryId: 101 },
      },
      { user: ctx.owner },
    );
    const switched = (
      await ctx.api.connectProjectGitHub.fetch(
        {
          params: { projectId: ctx.project.id },
          body: { installationId: 7, repositoryId: 102 },
        },
        { user: ctx.owner },
      )
    ).data;
    expect(switched.fullName).toBe("acme/api");
  });
});

describe("a connection GitHub ends or renames", () => {
  const connected = async () => {
    const ctx = await setup();
    await back(ctx, {
      state: await install(ctx),
      code: "good",
      installationId: 8,
    });
    return ctx;
  };

  it("disconnects from settings and says so", async ({ expect }) => {
    const ctx = await connected();
    const status = (
      await ctx.api.disconnectProjectGitHub.fetch(
        { params: { projectId: ctx.project.id } },
        { user: ctx.owner },
      )
    ).data;
    expect(status.connection).toMatchObject({
      connected: false,
      disconnectReason: "member",
    });
    expect(await ctx.service.connectionOf(ctx.project.id)).toBeUndefined();
  });

  it("leaves the project disconnected when the App is uninstalled, suspended or loses the repository", async ({
    expect,
  }) => {
    for (const [act, reason] of [
      [
        (ctx: Ctx) => ctx.service.installationGone(8, "uninstalled"),
        "uninstalled",
      ],
      [(ctx: Ctx) => ctx.service.installationGone(8, "suspended"), "suspended"],
      [(ctx: Ctx) => ctx.service.repositoriesRemoved(8, [201]), "removed"],
    ] as const) {
      const ctx = await connected();
      await act(ctx);
      const status = (
        await ctx.api.getProjectGitHub.fetch(
          { params: { projectId: ctx.project.id } },
          { user: ctx.owner },
        )
      ).data;
      expect(status.connection).toMatchObject({
        connected: false,
        disconnectReason: reason,
      });
    }
  });

  it("follows a rename or a transfer without breaking the link", async ({
    expect,
  }) => {
    const ctx = await connected();
    await ctx.service.repositoryRenamed(201, {
      owner: "acme-labs",
      name: "solo2",
    });
    const status = (
      await ctx.api.getProjectGitHub.fetch(
        { params: { projectId: ctx.project.id } },
        { user: ctx.owner },
      )
    ).data;
    expect(status.connection).toMatchObject({
      repositoryId: 201,
      fullName: "acme-labs/solo2",
      connected: true,
    });
    const project = await ctx.rows.projects.findById(ctx.project.id);
    expect(project!.repositoryUrl).toBe("https://github.com/acme-labs/solo2");
    const [row] = await ctx.rows.repositories.findMany({});
    expect(ctx.service.names(row, "acme/solo")).toBe(true);
    expect(ctx.service.names(row, "ACME-LABS/solo2")).toBe(true);
    expect(ctx.service.names(row, "acme/web")).toBe(false);
  });
});
