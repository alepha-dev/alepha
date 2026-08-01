import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { campaignSources } from "../src/api/entities/campaignSources.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { SourceTools } from "../src/mcp/tools/SourceTools.ts";

/**
 * The source tools exist so an agent can wire an observer to a campaign
 * without a browser. Every other step of that flow — enrol the app in Pulse,
 * point it at Lore — is already an API call; this was the one that was not.
 */

class Probe {
  sources = $repository(campaignSources);
}

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(AlephaMcp);
  alepha.with(LoreApi);
  alepha.with(LoreMcp);

  const probe = alepha.inject(Probe);
  const tools = alepha.inject(SourceTools);
  const campaignApi = alepha.inject(CampaignController);
  const users = alepha.inject(UserService);
  await alepha.start();

  // A real user row: membership carries a foreign key to it, so a made-up id
  // fails the constraint rather than the authorization check.
  const owner = await users.createUser({ username: "owner" });
  const OWNER = owner.id;

  /*
    Runs a tool the way the transport does.

    `execute()` is the entry point, and the caller's identity does NOT travel
    as an argument — the controllers behind these tools read it from the
    request context. So the call has to happen inside one, with the user
    seeded exactly where `$secure` looks.
  */
  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  // Created through the controller, not by inserting a row: ownership lives in
  // a membership record, and `resolveCampaignId` looks the campaign up among
  // the ones the caller belongs to. A bare row is a campaign nobody owns.
  const campaign = await asUser(OWNER, () =>
    campaignApi.createCampaign({ body: { title: "Test" } } as any),
  );

  return { alepha, probe, tools, campaign, call };
};

describe("Lore MCP — sources", () => {
  it("should issue a key and return it exactly once", async () => {
    const { tools, probe, campaign, call } = await setup();

    const created = await call(tools.source_create, {
      campaign: campaign.id,
      name: "Pulse",
    });

    expect(created.token).toMatch(/^src_/);

    // What is stored is a hash. The listing can name the key by its ends,
    // which is enough to match it against one you hold and useless to anyone
    // who only has the listing.
    const listed = await call(tools.source_list, { campaign: campaign.id });
    expect(listed.sources).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(created.token);

    const stored = await probe.sources.findMany({});
    expect(stored[0].tokenHash).not.toBe(created.token);
  });

  it("should grant only the scope a source needs", async () => {
    // Written explicitly by the controller rather than left to a column
    // default: what a key may do is an authorization decision, and one that
    // depends on a default being applied fails open at the worst moment.
    const { tools, probe, campaign, call } = await setup();

    await call(tools.source_create, { campaign: campaign.id, name: "Pulse" });

    expect((await probe.sources.findMany({}))[0].scopes).toEqual([
      "blight:write",
    ]);
  });

  it("should revoke without deleting what the source filed", async () => {
    /*
      Provenance survives revocation. Blights keep pointing at the source that
      filed them, so "where did this come from" still has an answer after the
      key is dead — which is the one thing an audit trail is for, and the whole
      reason this is not a delete.
    */
    const { tools, probe, campaign, call } = await setup();

    const created = await call(tools.source_create, {
      campaign: campaign.id,
      name: "Pulse",
    });
    const revoked = await call(tools.source_revoke, {
      campaign: campaign.id,
      id: created.id,
    });

    expect(revoked.revokedAt).toBeTruthy();
    const rows = await probe.sources.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0].revokedAt).toBeTruthy();
  });

  it("should refuse a campaign the caller does not own", async () => {
    // The tools run with the caller's identity, not the server's. An agent
    // holding an MCP key for one campaign must not be able to issue a
    // blight-writing credential for someone else's.
    const { tools, campaign, call } = await setup();

    await expect(
      call(
        tools.source_create,
        { campaign: campaign.id, name: "Intruder" },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow();
  });
});
