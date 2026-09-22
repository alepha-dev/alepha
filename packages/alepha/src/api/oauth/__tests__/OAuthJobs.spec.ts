import { Alepha } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { oauthClientEntity } from "../entities/oauthClientEntity.ts";
import { OAuthJobs } from "../jobs/OAuthJobs.ts";
import { OAuthClientService } from "../services/OAuthClientService.ts";

/**
 * ⚠️ "Abandoned" means never used, not "no session right now" (#Q2413).
 *
 * ChatGPT registers once and keeps its `client_id` for the life of the
 * connector. When the job deleted every client without a live session, a
 * session that ended turned into a connector that could never sign in again.
 */
describe("OAuthJobs.purgeAbandonedClients", () => {
  class TestRepositories {
    clients = $repository(oauthClientEntity);
  }

  const setup = async (sessions: string[] = []) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaApiJobs);
    const jobs = alepha.inject(OAuthJobs);
    const repos = alepha.inject(TestRepositories);
    const service = alepha.inject(OAuthClientService);
    const dateTime = alepha.inject(DateTimeProvider);
    // What `$realm` registers: the clients a session still references.
    service.registerSessionProbe(
      async (clientIds) =>
        new Set(clientIds.filter((id) => sessions.includes(id))),
    );
    await alepha.start();

    const now = dateTime.now();
    const twoDaysAgo = now.subtract(2, "days").toISOString();
    const client = async (
      clientId: string,
      options: { lastUsedAt?: string; createdAt?: string } = {},
    ) => {
      const row = await repos.clients.create({
        clientId,
        clientName: "ChatGPT",
        realm: "users",
        redirectUris: ["https://chatgpt.com/connector/oauth/cb"],
        lastUsedAt: options.lastUsedAt,
      });
      await repos.clients.updateById(row.id, {
        createdAt: options.createdAt ?? twoDaysAgo,
      });
      return row;
    };

    const remaining = async () =>
      (await repos.clients.findMany())
        .map((row) => row.clientId)
        .sort((a, b) => a.localeCompare(b));

    return { jobs, client, remaining, now, twoDaysAgo };
  };

  it("keeps a client that was used once and has no session left", async ({
    expect,
  }) => {
    const { jobs, client, remaining, twoDaysAgo } = await setup();
    await client("mcp_used", { lastUsedAt: twoDaysAgo });

    await jobs.purgeAbandonedClients.trigger();

    expect(await remaining()).toEqual(["mcp_used"]);
  });

  it("deletes a never-used client older than 24 hours", async ({ expect }) => {
    const { jobs, client, remaining } = await setup();
    await client("mcp_abandoned");

    await jobs.purgeAbandonedClients.trigger();

    expect(await remaining()).toEqual([]);
  });

  it("keeps a never-used client registered less than 24 hours ago", async ({
    expect,
  }) => {
    const { jobs, client, remaining, now } = await setup();
    // Registered an hour ago: somebody may still be reading the consent
    // screen.
    await client("mcp_fresh", {
      createdAt: now.subtract(1, "hour").toISOString(),
    });
    await client("mcp_old");

    await jobs.purgeAbandonedClients.trigger();

    expect(await remaining()).toEqual(["mcp_fresh"]);
  });

  it("keeps a never-used client a session still references", async ({
    expect,
  }) => {
    const { jobs, client, remaining } = await setup(["mcp_session"]);
    await client("mcp_session");

    await jobs.purgeAbandonedClients.trigger();

    expect(await remaining()).toEqual(["mcp_session"]);
  });
});
