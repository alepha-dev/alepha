import { generateKeyPairSync } from "node:crypto";

import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { LoreCoreApi } from "../src/api/index.ts";
import { GitHubAppJwt } from "../src/api/services/GitHubAppJwt.ts";
import { GitHubAppService } from "../src/api/services/GitHubAppService.ts";
import { GitHubClient } from "../src/api/services/GitHubClient.ts";
import { GitHubKeyFormat } from "../src/api/services/GitHubKeyFormat.ts";
import { GitHubTokenService } from "../src/api/services/GitHubTokenService.ts";
import { GitHubTransport } from "../src/api/services/GitHubTransport.ts";
import { CoreTestEntities } from "../src/testing/entities.ts";
import { MemoryGitHubTransport } from "../src/testing/MemoryGitHubTransport.ts";

/**
 * A key pair as GitHub hands the private half over: PKCS#1 PEM.
 */
const pair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const base64url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) =>
    char.charCodeAt(0),
  );

const spki = (pem: string) =>
  base64url(
    pem
      .replace(/-----[A-Z ]+-----/g, "")
      .replace(/\s+/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_"),
  );

const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      DATABASE_URL: ":memory:",
      SERVER_PORT: 0,
      APP_SECRET: "a-strong-unique-secret-for-the-github-token-spec",
      GITHUB_APP_ID: "4242",
      GITHUB_APP_SLUG: "lore-acme",
      GITHUB_APP_CLIENT_ID: "Iv1.acme",
      GITHUB_APP_CLIENT_SECRET: "client-secret",
      GITHUB_APP_WEBHOOK_SECRET: "webhook-secret",
      GITHUB_APP_PRIVATE_KEY: pair.privateKey,
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
  const tokens = alepha.inject(GitHubTokenService);
  await alepha.start();
  const github = alepha.inject(MemoryGitHubTransport);
  const dateTime = alepha.inject(DateTimeProvider);
  let minted = 0;
  github.on("POST", /^\/app\/installations\/(\d+)\/access_tokens$/, (_r, m) => {
    if (m[1] === "404") return { status: 404, json: { message: "Not Found" } };
    if (m[1] === "422") {
      return {
        status: 422,
        json: {
          message:
            "There is at least one repository that does not exist or is not accessible to the parent installation.",
        },
      };
    }
    minted++;
    return {
      status: 201,
      json: {
        token: `ghs_token${minted}`,
        expires_at: new Date(dateTime.nowMillis() + 3_600_000).toISOString(),
        permissions: { contents: "read", metadata: "read" },
      },
    };
  });
  return { alepha, tokens, github, dateTime };
};

describe("the GitHub App JWT", () => {
  it("signs RS256 with WebCrypto, iat backdated for skew and exp under ten minutes", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    const jwt = alepha.inject(GitHubAppJwt);
    const keys = alepha.inject(GitHubKeyFormat);
    const dateTime = alepha.inject(DateTimeProvider);
    dateTime.pause();
    const now = Math.floor(dateTime.nowMillis() / 1000);

    const token = await jwt.sign("4242", keys.toPkcs8Pem(pair.privateKey));
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(new TextDecoder().decode(base64url(header)))).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    const claims = JSON.parse(new TextDecoder().decode(base64url(payload)));
    expect(claims).toEqual({ iat: now - 60, exp: now + 540, iss: "4242" });
    expect(claims.exp - now).toBeLessThanOrEqual(600);

    const publicKey = await crypto.subtle.importKey(
      "spki",
      spki(pair.publicKey),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    expect(
      await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        base64url(signature),
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    ).toBe(true);
  });

  it("converts the PKCS#1 key GitHub gives to PKCS#8, and keeps a PKCS#8 key as it is", ({
    expect,
  }) => {
    const keys = new GitHubKeyFormat();
    const pkcs8 = keys.toPkcs8Pem(pair.privateKey);
    expect(pkcs8).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
    // Node reads the same key back out of both.
    const native = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    }).privateKey;
    expect(keys.toPkcs8Pem(native).replace(/\s+/g, "")).toBe(
      native.replace(/\s+/g, ""),
    );
    expect(() => keys.toPkcs8Pem("not a key")).toThrow(/not a PEM block/);
    expect(() =>
      keys.toPkcs8Pem(
        "-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----",
      ),
    ).toThrow(/not an RSA private key/);
  });
});

describe("installation tokens", () => {
  it("mints a token for one repository and the permission set asked, and reuses it", async ({
    expect,
  }) => {
    const { tokens, github } = await setup();
    const first = await tokens.installationToken({
      installationId: 11,
      repositoryId: 99,
      permissions: { contents: "read", metadata: "read" },
    });
    const again = await tokens.installationToken({
      installationId: 11,
      repositoryId: 99,
      permissions: { metadata: "read", contents: "read" },
    });
    expect(again.token).toBe(first.token);

    const sent = github.sent(
      "POST",
      /^\/app\/installations\/11\/access_tokens$/,
    );
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0].body!)).toEqual({
      repository_ids: [99],
      permissions: { contents: "read", metadata: "read" },
    });
    // Signed as the App, never as a token.
    expect(sent[0].headers?.authorization).toMatch(/^Bearer ey/);
    expect(sent[0].headers?.["x-github-api-version"]).toBe("2022-11-28");

    // A narrower set is another token.
    const narrow = await tokens.installationToken({
      installationId: 11,
      repositoryId: 99,
      permissions: { actions: "write" },
    });
    expect(narrow.token).not.toBe(first.token);
  });

  it("mints again five minutes before expiry, and never sooner", async ({
    expect,
  }) => {
    const { tokens, dateTime } = await setup();
    const ask = () =>
      tokens.installationToken({
        installationId: 11,
        repositoryId: 99,
        permissions: GitHubTokenService.READ,
      });
    const first = await ask();
    await dateTime.travel(54, "minutes");
    expect((await ask()).token).toBe(first.token);
    await dateTime.travel(2, "minutes");
    expect((await ask()).token).not.toBe(first.token);
  });

  it("says a revoked installation or a removed repository plainly, as a 404", async ({
    expect,
  }) => {
    const { tokens } = await setup();
    await expect(
      tokens.installationToken({
        installationId: 404,
        repositoryId: 1,
        permissions: GitHubTokenService.READ,
      }),
    ).rejects.toThrow(/no longer installed/);
    await expect(
      tokens.installationToken({
        installationId: 422,
        repositoryId: 1,
        permissions: GitHubTokenService.READ,
      }),
    ).rejects.toThrow(/no longer holds this repository/);
  });

  it("forgets an installation's tokens", async ({ expect }) => {
    const { tokens, github } = await setup();
    const ask = () =>
      tokens.installationToken({
        installationId: 11,
        repositoryId: 99,
        permissions: GitHubTokenService.READ,
      });
    await ask();
    tokens.forget(11);
    await ask();
    expect(
      github.sent("POST", /^\/app\/installations\/11\/access_tokens$/),
    ).toHaveLength(2);
  });

  it("derives the bot's login and noreply address from its user id", async ({
    expect,
  }) => {
    const { tokens, github } = await setup();
    github.on("GET", /^\/users\/lore-acme\[bot\]$/, {
      json: { id: 123456, login: "lore-acme[bot]" },
    });
    expect(await tokens.botIdentity()).toEqual({
      name: "lore-acme[bot]",
      email: "123456+lore-acme[bot]@users.noreply.github.com",
    });
  });
});

describe("the GitHub client", () => {
  it("turns GitHub's refusals into Lore errors that carry no token, and reads the rate limit", async ({
    expect,
  }) => {
    const { alepha, github } = await setup();
    const client = alepha.inject(GitHubClient);
    github.on("GET", /^\/repositories\/1$/, {
      status: 403,
      headers: {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1700000000",
      },
      json: { message: "API rate limit exceeded" },
    });
    github.on("GET", /^\/repositories\/2$/, {
      headers: { "x-ratelimit-remaining": "4999" },
      json: {
        id: 2,
        name: "web",
        owner: { login: "acme" },
        default_branch: "main",
        private: true,
      },
    });
    await expect(client.getRepository("ghs_secret", 1)).rejects.toThrow(
      /rate limit/,
    );
    await expect(client.getRepository("ghs_secret", 3)).rejects.toThrow(
      /GitHub answered 404/,
    );
    await client.getRepository("ghs_secret", 3).catch((error: Error) => {
      expect(error.message).not.toContain("ghs_secret");
    });
    expect(await client.getRepository("ghs_secret", 2)).toEqual({
      id: 2,
      owner: "acme",
      name: "web",
      fullName: "acme/web",
      defaultBranch: "main",
      private: true,
    });
    expect(client.rateLimit.remaining).toBe(4999);
  });

  it("refuses to sign as an App the instance does not have", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:", SERVER_PORT: 0 },
    });
    alepha.with({ provide: GitHubTransport, use: MemoryGitHubTransport });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(LoreCoreApi);
    alepha.inject(CoreTestEntities);
    const tokens = alepha.inject(GitHubTokenService);
    alepha.inject(GitHubAppService);
    await alepha.start();
    await expect(
      tokens.installationToken({
        installationId: 1,
        repositoryId: 1,
        permissions: GitHubTokenService.READ,
      }),
    ).rejects.toThrow(/no GitHub App/);
  });
});
