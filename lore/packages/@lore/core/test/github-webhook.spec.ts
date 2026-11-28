import { generateKeyPairSync } from "node:crypto";

import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { AdminGitHubController } from "../src/api/controllers/AdminGitHubController.ts";
import { githubDeliveries } from "../src/api/entities/githubDeliveries.ts";
import { projectRepositories } from "../src/api/entities/projectRepositories.ts";
import { LoreCoreApi } from "../src/api/index.ts";
import { GitHubDeliveryService } from "../src/api/services/GitHubDeliveryService.ts";
import { GitHubTransport } from "../src/api/services/GitHubTransport.ts";
import { GitHubWebhookHandlers } from "../src/api/services/GitHubWebhookHandlers.ts";
import { GitHubWebhookSignature } from "../src/api/services/GitHubWebhookSignature.ts";
import { ProjectRepositoryService } from "../src/api/services/ProjectRepositoryService.ts";
import {
  CoreTestEntities,
  createTestProject,
} from "../src/testing/entities.ts";
import { MemoryGitHubTransport } from "../src/testing/MemoryGitHubTransport.ts";

class Rows {
  deliveries = $repository(githubDeliveries);
  repositories = $repository(projectRepositories);
}

const SECRET = "webhook-secret";

const pkcs1 = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      APP_SECRET: "a-strong-unique-secret-for-the-github-webhook-spec",
      GITHUB_APP_ID: "4242",
      GITHUB_APP_SLUG: "lore-acme",
      GITHUB_APP_CLIENT_ID: "Iv1.acme",
      GITHUB_APP_CLIENT_SECRET: "client-secret",
      GITHUB_APP_WEBHOOK_SECRET: SECRET,
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

  const project = await createTestProject(alepha, { title: "Acme web" });
  await rows.repositories.create({
    id: crypto.randomUUID(),
    projectId: project.id,
    installationId: 7,
    repositoryId: 101,
    owner: "acme",
    name: "web",
    defaultBranch: "main",
    connectedBy: project.createdBy,
    connectedAt: "2026-11-28T10:00:00.000Z",
  });

  // A spec handler, counting what it saw, failing while `fail` is set.
  const seen: string[] = [];
  let fail = false;
  alepha.inject(GitHubWebhookHandlers).register("issues", async (context) => {
    if (fail) throw new Error("handler broke");
    seen.push(`${context.delivery}:${context.connection?.projectId}`);
  });

  const url = `${alepha.inject(NodeHttpServerProvider).hostname}/api/github/webhook`;
  const signer = alepha.inject(GitHubWebhookSignature);
  const post = async (input: {
    event?: string;
    delivery?: string;
    body: string;
    secret?: string | null;
  }) =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.event ? { "x-github-event": input.event } : {}),
        ...(input.delivery ? { "x-github-delivery": input.delivery } : {}),
        ...(input.secret === null
          ? {}
          : {
              "x-hub-signature-256": await signer.sign(
                input.body,
                input.secret ?? SECRET,
              ),
            }),
      },
      body: input.body,
    });
  const status = async (id: string) =>
    (await rows.deliveries.findMany({ where: { id: { eq: id } } }))[0]?.status;
  const settled = async (id: string) => {
    for (let i = 0; i < 100; i++) {
      const value = await status(id);
      if (value && value !== "pending") return value;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return await status(id);
  };
  return {
    alepha,
    rows,
    project,
    post,
    status,
    settled,
    seen,
    setFail: (value: boolean) => {
      fail = value;
    },
    deliveries: alepha.inject(GitHubDeliveryService),
    github: alepha.inject(MemoryGitHubTransport),
  };
};

const issue = (repositoryId = 101) =>
  JSON.stringify({
    action: "opened",
    installation: { id: 7 },
    repository: { id: repositoryId, full_name: "acme/web" },
    issue: { number: 1, title: "x" },
  });

describe("the GitHub webhook endpoint", () => {
  it("refuses a forged or missing signature with a 401 and stores nothing", async ({
    expect,
  }) => {
    const ctx = await setup();
    const forged = await ctx.post({
      event: "issues",
      delivery: "d-1",
      body: issue(),
      secret: "another-secret",
    });
    expect(forged.status).toBe(401);
    const missing = await ctx.post({
      event: "issues",
      delivery: "d-2",
      body: issue(),
      secret: null,
    });
    expect(missing.status).toBe(401);
    expect(await ctx.rows.deliveries.count()).toBe(0);
  });

  it("refuses a signed delivery without its GitHub headers", async ({
    expect,
  }) => {
    const ctx = await setup();
    expect((await ctx.post({ event: "issues", body: issue() })).status).toBe(
      400,
    );
  });

  it("stores a delivery, answers 202 at once, then hands it to its project's handler", async ({
    expect,
  }) => {
    const ctx = await setup();
    const response = await ctx.post({
      event: "issues",
      delivery: "d-ok",
      body: issue(),
    });
    expect(response.status).toBe(202);
    expect(await ctx.settled("d-ok")).toBe("handled");
    expect(ctx.seen).toEqual([`d-ok:${ctx.project.id}`]);
    const [row] = await ctx.rows.deliveries.findMany({});
    // The body goes once the delivery is settled.
    expect(row.payload ?? undefined).toBeUndefined();
    expect(row.projectId).toBe(ctx.project.id);
  });

  it("acknowledges a replayed GUID and never handles it twice", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.post({ event: "issues", delivery: "d-twice", body: issue() });
    await ctx.settled("d-twice");
    const again = await ctx.post({
      event: "issues",
      delivery: "d-twice",
      body: issue(),
    });
    expect(again.status).toBe(200);
    await ctx.deliveries.handle("d-twice");
    expect(ctx.seen).toHaveLength(1);
  });

  it("drops a delivery for a repository no project holds, and an oversized one", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.post({
      event: "issues",
      delivery: "d-unknown",
      body: issue(999),
    });
    expect(await ctx.settled("d-unknown")).toBe("dropped");
    const big = JSON.stringify({
      action: "opened",
      repository: { id: 101 },
      filler: "x".repeat(GitHubDeliveryService.MAX_BYTES),
    });
    const response = await ctx.post({
      event: "issues",
      delivery: "d-big",
      body: big,
    });
    expect(response.status).toBe(202);
    expect(await ctx.status("d-big")).toBe("dropped");
    expect(ctx.seen).toHaveLength(0);
  });

  it("marks a failing handler failed, and the sweep retries it", async ({
    expect,
  }) => {
    const ctx = await setup();
    ctx.setFail(true);
    await ctx.post({ event: "issues", delivery: "d-fail", body: issue() });
    expect(await ctx.settled("d-fail")).toBe("failed");
    ctx.setFail(false);
    await ctx.deliveries.sweep();
    expect(await ctx.status("d-fail")).toBe("handled");
    expect(ctx.seen).toEqual([`d-fail:${ctx.project.id}`]);
  });

  it("sweeps a delivery left pending past its minute, and prunes after seven days", async ({
    expect,
  }) => {
    const ctx = await setup();
    const dateTime = ctx.alepha.inject(DateTimeProvider);
    await ctx.rows.deliveries.create({
      id: "d-lost",
      event: "issues",
      repositoryId: 101,
      status: "pending",
      attempts: 0,
      payload: issue(),
      receivedAt: dateTime.nowISOString(),
    });
    await ctx.deliveries.sweep();
    expect(await ctx.status("d-lost")).toBe("pending");
    await dateTime.travel(2, "minutes");
    await ctx.deliveries.sweep();
    expect(await ctx.status("d-lost")).toBe("handled");
    await dateTime.travel(8, "days");
    await ctx.deliveries.sweep();
    expect(await ctx.status("d-lost")).toBeUndefined();
  });

  it("disconnects the project when GitHub says the App was uninstalled", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.post({
      event: "installation",
      delivery: "d-uninstall",
      body: JSON.stringify({ action: "deleted", installation: { id: 7 } }),
    });
    expect(await ctx.settled("d-uninstall")).toBe("handled");
    const connection = await ctx.alepha
      .inject(ProjectRepositoryService)
      .connectionOf(ctx.project.id);
    expect(connection).toBeUndefined();
    const [row] = await ctx.rows.repositories.findMany({});
    expect(row.disconnectReason).toBe("uninstalled");
  });

  it("follows a repository rename", async ({ expect }) => {
    const ctx = await setup();
    await ctx.post({
      event: "repository",
      delivery: "d-rename",
      body: JSON.stringify({
        action: "renamed",
        installation: { id: 7 },
        repository: {
          id: 101,
          name: "website",
          owner: { login: "acme" },
          default_branch: "main",
        },
      }),
    });
    expect(await ctx.settled("d-rename")).toBe("handled");
    const [row] = await ctx.rows.repositories.findMany({});
    expect(`${row.owner}/${row.name}`).toBe("acme/website");
  });

  it("asks GitHub once to redeliver what Lore never stored", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.post({ event: "issues", delivery: "stored-guid", body: issue() });
    await ctx.settled("stored-guid");
    ctx.github.on("GET", /^\/app\/hook\/deliveries$/, {
      json: [
        {
          id: 1,
          guid: "lost-guid",
          status_code: 500,
          delivered_at: "x",
          redelivery: false,
        },
        {
          id: 2,
          guid: "stored-guid",
          status_code: 502,
          delivered_at: "x",
          redelivery: false,
        },
        {
          id: 3,
          guid: "fine-guid",
          status_code: 202,
          delivered_at: "x",
          redelivery: false,
        },
      ],
    });
    ctx.github.on("POST", /^\/app\/hook\/deliveries\/(\d+)\/attempts$/, {
      status: 202,
      json: {},
    });
    expect(await ctx.deliveries.redeliver()).toBe(1);
    expect(await ctx.deliveries.redeliver()).toBe(0);
    expect(
      ctx.github
        .sent("POST", /^\/app\/hook\/deliveries\/\d+\/attempts$/)
        .map((request) => new URL(request.url).pathname),
    ).toEqual(["/app/hook/deliveries/1/attempts"]);
  });

  it("lists recent deliveries for an admin, never their body", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.post({ event: "issues", delivery: "d-list", body: issue() });
    await ctx.settled("d-list");
    const listed = (
      await ctx.alepha.inject(AdminGitHubController).listGitHubDeliveries.fetch(
        {},
        {
          user: { id: crypto.randomUUID(), roles: ["admin"] },
        },
      )
    ).data.items;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: "d-list",
      event: "issues",
      action: "opened",
      repository: "acme/web",
      status: "handled",
      attempts: 1,
    });
    expect("payload" in listed[0]).toBe(false);
  });
});
