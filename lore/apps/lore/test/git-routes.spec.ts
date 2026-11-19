import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaReactRouter } from "alepha/react/router";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * The git routes beside every page (#Q3932): six `$route`s with static
 * tails (`info/refs`, `git-upload-pack`, `git-receive-pack`) under one or two
 * params, registered with all of Lore's routers. A `.git` URL reaches git and
 * answers its Basic challenge; a project page next to it still reaches the
 * page.
 */
describe("git routes among Lore's pages", () => {
  let alepha: Alepha;
  let baseUrl: string;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaReactRouter);
    bootLore(alepha, ["api", "routes"]);
    await alepha.start();
    baseUrl = alepha.inject(NodeHttpServerProvider).hostname;
  });

  afterEach(async () => {
    await alepha.stop();
  });

  it("sends a .git URL to git, under one segment or two", async ({
    expect,
  }) => {
    for (const path of [
      "/acme.git/info/refs?service=git-upload-pack",
      "/acme/api.git/info/refs?service=git-upload-pack",
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toMatch(/^Basic/);
    }
    const push = await fetch(`${baseUrl}/acme/api.git/git-receive-pack`, {
      method: "POST",
      body: "0000",
    });
    expect(push.status).toBe(401);
  });

  it("leaves a project page to the page router", async ({ expect }) => {
    const response = await fetch(`${baseUrl}/acme/quests`, {
      redirect: "manual",
    });
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(response.status).not.toBe(401);
  });
});
