import { generateKeyPairSync } from "node:crypto";

import { Alepha } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { AdminGitHubController } from "../src/api/controllers/AdminGitHubController.ts";
import { githubApps } from "../src/api/entities/githubApps.ts";
import { LoreCoreApi } from "../src/api/index.ts";
import { CredentialSealService } from "../src/api/services/CredentialSealService.ts";
import { GitHubAppService } from "../src/api/services/GitHubAppService.ts";
import { GitHubTransport } from "../src/api/services/GitHubTransport.ts";
import { GitHubWebhookSignature } from "../src/api/services/GitHubWebhookSignature.ts";
import { CoreTestEntities } from "../src/testing/entities.ts";
import { MemoryGitHubTransport } from "../src/testing/MemoryGitHubTransport.ts";

class Rows {
  apps = $repository(githubApps);
}

const APP_SECRET = "a-strong-unique-secret-for-the-github-app-spec";

/**
 * A private key as GitHub hands it over: PKCS#1 PEM.
 */
const pkcs1 = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

const conversion = {
  id: 424242,
  slug: "lore-acme",
  name: "Lore acme",
  html_url: "https://github.com/apps/lore-acme",
  owner: { login: "acme" },
  client_id: "Iv1.abc123",
  client_secret: "client-secret-value",
  webhook_secret: "webhook-secret-value",
  pem: pkcs1,
};

const setup = async (env: Record<string, string> = {}) => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      APP_SECRET,
      PUBLIC_URL: "https://lore.example.app",
      ...env,
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
  github.on("POST", /^\/app-manifests\/([^/]+)\/conversions$/, (_r, match) =>
    match[1] === "good-code"
      ? { status: 201, json: conversion }
      : { status: 404, json: { message: "Not Found" } },
  );
  const api = alepha.inject(AdminGitHubController);
  const users = alepha.inject(AdminUserController);
  const root = { id: crypto.randomUUID(), roles: ["admin"] };
  const user = async (name: string, roles: string[]) => {
    const created = await users.createUser.fetch(
      { body: { username: name, email: `${name}@example.app`, roles } },
      { user: root },
    );
    return { id: created.data.id, roles: created.data.roles };
  };
  const admin = await user("admin", ["admin"]);
  const other = await user("other", ["admin"]);
  const member = await user("member", ["user"]);
  const url = alepha.inject(NodeHttpServerProvider).hostname;
  return { alepha, rows, github, api, admin, other, member, url };
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const create = async (ctx: Ctx, user = ctx.admin) => {
  const start = await ctx.api.startGitHubAppManifest.fetch(
    { body: { name: "Lore acme" } },
    { user },
  );
  return start.data;
};

describe("the instance GitHub App", () => {
  it("has none until an admin creates it, and says where GitHub will post", async ({
    expect,
  }) => {
    const ctx = await setup();
    const status = (await ctx.api.getGitHubApp.fetch({}, { user: ctx.admin }))
      .data;
    expect(status).toEqual({
      configured: false,
      webhookUrl: "https://lore.example.app/api/github/webhook",
    });
  });

  it("refuses a member who is not an instance admin", async ({ expect }) => {
    const ctx = await setup();
    await expect(
      ctx.api.getGitHubApp.fetch({}, { user: ctx.member }),
    ).rejects.toThrow();
    await expect(create(ctx, ctx.member)).rejects.toThrow();
  });

  it("answers a manifest with the permissions, events and user authorization the epic asks", async ({
    expect,
  }) => {
    const ctx = await setup();
    const start = await create(ctx);
    expect(start.action).toMatch(
      /^https:\/\/github\.com\/settings\/apps\/new\?state=/,
    );
    const manifest = JSON.parse(start.manifest);
    expect(manifest).toMatchObject({
      name: "Lore acme",
      hook_attributes: {
        url: "https://lore.example.app/api/github/webhook",
        active: true,
      },
      redirect_url: "https://lore.example.app/admin/github",
      callback_urls: ["https://lore.example.app/github/connect"],
      request_oauth_on_install: true,
      default_permissions: {
        metadata: "read",
        contents: "write",
        actions: "write",
        pull_requests: "write",
        checks: "write",
        statuses: "write",
      },
    });
    expect(manifest.default_permissions.workflows).toBeUndefined();
    expect(manifest.default_events).toEqual(
      expect.arrayContaining([
        "repository",
        "push",
        "pull_request",
        "pull_request_review",
        "check_suite",
        "check_run",
        "status",
        "workflow_run",
      ]),
    );

    const org = await ctx.api.startGitHubAppManifest.fetch(
      { body: { organization: "acme" } },
      { user: ctx.admin },
    );
    expect(org.data.action).toMatch(
      /^https:\/\/github\.com\/organizations\/acme\/settings\/apps\/new\?state=/,
    );
  });

  it("makes the App public by default, and private when asked (#Q4561)", async ({
    expect,
  }) => {
    const ctx = await setup();
    const open = await create(ctx);
    expect(JSON.parse(open.manifest).public).toBe(true);

    const closed = await ctx.api.startGitHubAppManifest.fetch(
      { body: { name: "Lore acme", public: false } },
      { user: ctx.admin },
    );
    expect(JSON.parse(closed.data.manifest).public).toBe(false);
  });

  it("links to the App's settings on GitHub, under its owner's kind (#Q4561)", async ({
    expect,
  }) => {
    const ctx = await setup();
    const start = await create(ctx);
    await ctx.api.completeGitHubAppManifest.fetch(
      { body: { code: "good-code", state: start.state } },
      { user: ctx.admin },
    );
    const status = async () =>
      (await ctx.api.getGitHubApp.fetch({}, { user: ctx.admin })).data;

    // GitHub out of reach: no link, and the page still reads.
    expect((await status()).settingsUrl).toBeUndefined();

    ctx.github.on("GET", /^\/app$/, {
      json: { owner: { login: "acme", type: "Organization" } },
    });
    expect((await status()).settingsUrl).toBe(
      "https://github.com/organizations/acme/settings/apps/lore-acme",
    );

    ctx.github.on("GET", /^\/app$/, {
      json: { owner: { login: "jane", type: "User" } },
    });
    expect((await status()).settingsUrl).toBe(
      "https://github.com/settings/apps/lore-acme",
    );
  });

  it("refuses a manifest while PUBLIC_URL is not set", async ({ expect }) => {
    const ctx = await setup({ PUBLIC_URL: "" });
    await expect(create(ctx)).rejects.toThrow(/PUBLIC_URL/);
  });

  it("stores what GitHub returns, secrets sealed and the key as PKCS#8", async ({
    expect,
  }) => {
    const ctx = await setup();
    const start = await create(ctx);
    const status = (
      await ctx.api.completeGitHubAppManifest.fetch(
        { body: { code: "good-code", state: start.state } },
        { user: ctx.admin },
      )
    ).data;
    expect(status).toMatchObject({
      configured: true,
      source: "stored",
      appId: "424242",
      slug: "lore-acme",
      ownerLogin: "acme",
      installUrl: "https://github.com/apps/lore-acme/installations/new",
    });
    // Nothing secret travels back.
    expect(JSON.stringify(status)).not.toMatch(
      /secret-value|PRIVATE KEY|Iv1\.abc123/,
    );

    const [row] = await ctx.rows.apps.findMany({});
    expect(row.clientSecret).not.toContain("client-secret-value");
    expect(row.webhookSecret).not.toContain("webhook-secret-value");
    expect(row.privateKey).not.toContain("PRIVATE KEY");
    const seal = ctx.alepha.inject(CredentialSealService);
    const key = await seal.open(
      row.privateKey,
      CredentialSealService.GITHUB_APP_PURPOSE,
    );
    expect(key).toMatch(/^-----BEGIN PRIVATE KEY-----/);

    const credentials = await ctx.alepha.inject(GitHubAppService).credentials();
    expect(credentials).toMatchObject({
      source: "stored",
      appId: "424242",
      webhookSecret: "webhook-secret-value",
      clientSecret: "client-secret-value",
    });
  });

  it("refuses a replayed callback, a forged state and another admin's state", async ({
    expect,
  }) => {
    const ctx = await setup();
    const start = await create(ctx);

    await expect(
      ctx.api.completeGitHubAppManifest.fetch(
        { body: { code: "good-code", state: `${start.state}0` } },
        { user: ctx.admin },
      ),
    ).rejects.toThrow(/expired or was already used/);
    await expect(
      ctx.api.completeGitHubAppManifest.fetch(
        { body: { code: "good-code", state: start.state } },
        { user: ctx.other },
      ),
    ).rejects.toThrow(/expired or was already used/);
    // Neither attempt asked GitHub anything.
    expect(ctx.github.requests).toHaveLength(0);

    await ctx.api.completeGitHubAppManifest.fetch(
      { body: { code: "good-code", state: start.state } },
      { user: ctx.admin },
    );
    await expect(
      ctx.api.completeGitHubAppManifest.fetch(
        { body: { code: "good-code", state: start.state } },
        { user: ctx.admin },
      ),
    ).rejects.toThrow(/expired or was already used/);
    expect(await ctx.rows.apps.count()).toBe(1);
  });

  it("refuses a second App, and a code GitHub does not know", async ({
    expect,
  }) => {
    const ctx = await setup();
    const bad = await create(ctx);
    await expect(
      ctx.api.completeGitHubAppManifest.fetch(
        { body: { code: "stale-code", state: bad.state } },
        { user: ctx.admin },
      ),
    ).rejects.toThrow(/refused to hand over/);
    expect(await ctx.rows.apps.count()).toBe(0);

    const start = await create(ctx);
    await ctx.api.completeGitHubAppManifest.fetch(
      { body: { code: "good-code", state: start.state } },
      { user: ctx.admin },
    );
    await expect(create(ctx)).rejects.toThrow(/already has a GitHub App/);
  });

  it("takes an App registered by hand from the environment, which wins", async ({
    expect,
  }) => {
    const ctx = await setup({
      GITHUB_APP_ID: "777",
      GITHUB_APP_SLUG: "lore-by-hand",
      GITHUB_APP_CLIENT_ID: "Iv1.hand",
      GITHUB_APP_CLIENT_SECRET: "hand-client-secret",
      GITHUB_APP_WEBHOOK_SECRET: "hand-webhook-secret",
      // As an environment variable often carries a PEM: escaped newlines.
      GITHUB_APP_PRIVATE_KEY: pkcs1.replace(/\n/g, "\\n"),
    });
    const status = (await ctx.api.getGitHubApp.fetch({}, { user: ctx.admin }))
      .data;
    expect(status).toMatchObject({
      configured: true,
      source: "environment",
      appId: "777",
      slug: "lore-by-hand",
    });
    const credentials = await ctx.alepha.inject(GitHubAppService).credentials();
    expect(credentials?.privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    await expect(create(ctx)).rejects.toThrow(/already has a GitHub App/);
  });

  it("names the variables missing from a partial environment", async ({
    expect,
  }) => {
    const ctx = await setup({ GITHUB_APP_ID: "777" });
    const status = (await ctx.api.getGitHubApp.fetch({}, { user: ctx.admin }))
      .data;
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual([
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APP_WEBHOOK_SECRET",
      "GITHUB_APP_CLIENT_ID",
      "GITHUB_APP_CLIENT_SECRET",
      "GITHUB_APP_SLUG",
    ]);
  });

  it("records GitHub's signed ping as the webhook being reachable, and refuses a bad signature", async ({
    expect,
  }) => {
    const ctx = await setup();
    const start = await create(ctx);
    await ctx.api.completeGitHubAppManifest.fetch(
      { body: { code: "good-code", state: start.state } },
      { user: ctx.admin },
    );
    const body = JSON.stringify({
      zen: "Keep it logically awesome.",
      hook_id: 1,
    });
    const signer = ctx.alepha.inject(GitHubWebhookSignature);
    const post = (signature: string | undefined) =>
      fetch(`${ctx.url}/api/github/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "ping",
          "x-github-delivery": crypto.randomUUID(),
          ...(signature ? { "x-hub-signature-256": signature } : {}),
        },
        body,
      });

    expect((await post(undefined)).status).toBe(401);
    expect((await post(await signer.sign(body, "another-secret"))).status).toBe(
      401,
    );
    let status = (await ctx.api.getGitHubApp.fetch({}, { user: ctx.admin }))
      .data;
    expect(status.webhookPingAt).toBeUndefined();

    expect(
      (await post(await signer.sign(body, "webhook-secret-value"))).status,
    ).toBe(200);
    status = (await ctx.api.getGitHubApp.fetch({}, { user: ctx.admin })).data;
    expect(status.webhookPingAt).toBeDefined();
  });

  it("refuses every delivery while the instance has no App", async ({
    expect,
  }) => {
    const ctx = await setup();
    const response = await fetch(`${ctx.url}/api/github/webhook`, {
      method: "POST",
      headers: {
        "x-github-event": "ping",
        "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
      },
      body: "{}",
    });
    expect(response.status).toBe(401);
  });
});
