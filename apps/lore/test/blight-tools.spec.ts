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
import { blights } from "../src/api/entities/blights.ts";
import { campaignSources } from "../src/api/entities/campaignSources.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { BlightTools } from "../src/mcp/tools/BlightTools.ts";
import { SourceTools } from "../src/mcp/tools/SourceTools.ts";

/**
 * The source tools exist so an agent can wire an observer to a campaign
 * without a browser. Every other step of that flow — enrol the app in Pulse,
 * point it at Lore — is already an API call; this was the one that was not.
 */

class Probe {
  sources = $repository(campaignSources);
  blights = $repository(blights);
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
  const blightTools = alepha.inject(BlightTools);
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

  const otherCampaign = await asUser(OWNER, () =>
    campaignApi.createCampaign({ body: { title: "Elsewhere" } } as any),
  );

  return { alepha, probe, tools, blightTools, campaign, otherCampaign, call };
};

describe("Lore MCP — blights", () => {
  /*
    These were deleted with `SigilTools`, which took the whole file when the
    sigil half went away. The controller behind them survived — but split in
    two: `listBlights` read the live table while resolve, forward and delete
    looked rows up in the vestigial `sigilBlights`. So every triage action on
    anything Pulse filed answered "Blight not found", for a row the inbox had
    just displayed.
  */

  const fileBlight = async (
    probe: any,
    campaignId: number,
    over: Record<string, unknown> = {},
  ) =>
    await probe.blights.create({
      campaignId,
      fingerprint: "fp-1",
      name: "TypeError",
      message: "Cannot read properties of undefined",
      stack: "TypeError\n    at cart (app.js:1:1)",
      sourceUrl: "https://demo.example.com/cart",
      release: "2026-08-01-a",
      pulseUrl: "https://pulse.example.com/apps/demo?view=errors",
      origin: "client",
      count: 7,
      firstSeenAt: "2026-08-01T10:00:00.000Z",
      lastSeenAt: "2026-08-01T10:05:00.000Z",
      ...over,
    } as any);

  it("should list what a source filed, with the link back to Pulse", async () => {
    // `pulseUrl` and `sourceId` were being stripped on the way out: the
    // response schema still named `sigilId`, and a schema is what serializes.
    const { probe, blightTools, campaign, call } = await setup();
    await fileBlight(probe, campaign.id);

    const res = await call(blightTools.blight_list, { campaign: campaign.id });

    expect(res.openCount).toBe(1);
    expect(res.blights[0]).toMatchObject({
      name: "TypeError",
      count: 7,
      release: "2026-08-01-a",
      pulseUrl: "https://pulse.example.com/apps/demo?view=errors",
    });
  });

  it("should hide resolved blights unless asked", async () => {
    const { probe, blightTools, campaign, call } = await setup();
    await fileBlight(probe, campaign.id, { status: "resolved" });

    const open = await call(blightTools.blight_list, { campaign: campaign.id });
    expect(open.blights).toHaveLength(0);
    expect(open.openCount).toBe(0);

    const all = await call(blightTools.blight_list, {
      campaign: campaign.id,
      include_resolved: true,
    });
    expect(all.blights).toHaveLength(1);
  });

  it("should resolve a blight the inbox just listed", async () => {
    // The exact case that was broken: list from one table, resolve against
    // another, "Blight not found".
    const { probe, blightTools, campaign, call } = await setup();
    const filed = await fileBlight(probe, campaign.id);

    const res = await call(blightTools.blight_resolve, {
      campaign: campaign.id,
      blight_id: filed.id,
    });

    expect(res.ok).toBe(true);
    const after = await call(blightTools.blight_list, {
      campaign: campaign.id,
    });
    expect(after.blights).toHaveLength(0);
  });

  it("should forward a blight into a quest and close it", async () => {
    const { probe, blightTools, campaign, call } = await setup();
    const filed = await fileBlight(probe, campaign.id);

    const res = await call(blightTools.blight_forward, {
      campaign: campaign.id,
      blight_id: filed.id,
    });

    expect(res.questShortId).toBeGreaterThan(0);
    const after = await call(blightTools.blight_list, {
      campaign: campaign.id,
    });
    expect(after.blights).toHaveLength(0);
  });

  it("should refuse a blight from another campaign", async () => {
    // Scoped by a WHERE clause on `campaignId` rather than by walking the
    // campaign's sigils — one less step to get wrong. A real second campaign,
    // because `campaignId` is a foreign key: an invented id fails on insert
    // and proves nothing about the scoping.
    const { probe, blightTools, campaign, call, otherCampaign } = await setup();
    const filed = await fileBlight(probe, otherCampaign.id);

    await expect(
      call(blightTools.blight_resolve, {
        campaign: campaign.id,
        blight_id: filed.id,
      }),
    ).rejects.toThrow();
  });
});
