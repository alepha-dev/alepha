import { Alepha, t } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { AlephaServerCors } from "alepha/server/cors";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { SigilController } from "../src/api/controllers/SigilController.ts";
import { SigilIngestController } from "../src/api/controllers/SigilIngestController.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = t.object({
  username: t.string(),
  email: t.email(),
});

interface TestContext {
  alepha: Alepha;
  baseUrl: string;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  sigilController: SigilController;
  sigilIngestController: SigilIngestController;
  fakeProvider: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      SERVER_HOST: "127.0.0.1",
      DATABASE_URL: ":memory:",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaServerCors);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  await alepha.start();
  const server = alepha.inject(ServerProvider);

  return {
    alepha,
    baseUrl: server.hostname,
    adminUserController: alepha.inject(AdminUserController),
    campaignController: alepha.inject(CampaignController),
    sigilController: alepha.inject(SigilController),
    sigilIngestController: alepha.inject(SigilIngestController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (
  ctx: TestContext,
): Promise<{ id: string; roles: string[] }> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

const createCampaign = async (
  ctx: TestContext,
  user: { id: string; roles: string[] },
  features: {
    sigils?: boolean;
    embeddedPetitions?: boolean;
  } = { sigils: true, embeddedPetitions: true },
): Promise<number> => {
  const created = await ctx.campaignController.createCampaign.fetch(
    {
      body: {
        title: "SigilPet",
        features,
      },
    },
    { user },
  );
  return created.data.id;
};

const createSigil = async (
  ctx: TestContext,
  campaignId: number,
  user: { id: string; roles: string[] },
  kinds: ("petition" | "blights" | "beacon" | "vitals")[] = ["petition"],
): Promise<string> => {
  const created = await ctx.sigilController.createSigil.fetch(
    {
      params: { campaignId },
      body: { label: "petition sigil", allowedOrigins: [], kinds },
    },
    { user },
  );
  return created.data.id;
};

/**
 * POST multipart to the sigil petition endpoint.
 * Returns the raw Response so individual tests can check status codes.
 */
const postPetition = async (
  ctx: TestContext,
  sigilId: string,
  fields: {
    title?: string;
    description?: string;
    type?: string;
    hostUrl?: string;
    hostPath?: string;
    reporterEmail?: string;
    screenshot?: { name: string; content: string; mimeType: string };
  },
): Promise<Response> => {
  const form = new FormData();
  form.append("title", fields.title ?? "Test bug");
  form.append("description", fields.description ?? "Something is broken");
  form.append("type", fields.type ?? "bug");
  form.append("hostUrl", fields.hostUrl ?? "https://example.com/shop");
  form.append("hostPath", fields.hostPath ?? "/shop");
  if (fields.reporterEmail) {
    form.append("reporterEmail", fields.reporterEmail);
  }
  if (fields.screenshot) {
    const blob = new Blob([fields.screenshot.content], {
      type: fields.screenshot.mimeType,
    });
    form.append("screenshot", blob, fields.screenshot.name);
  }

  return fetch(`${ctx.baseUrl}/sigils/${sigilId}/petition`, {
    method: "POST",
    body: form,
  });
};

describe("POST /sigils/:id/petition — anonymous sigil petition endpoint", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("creates a petition with source.sigilId, reporterEmail and status pending", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);

    const res = await postPetition(ctx, sigilId, {
      reporterEmail: "a@b.com",
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBeGreaterThan(0);

    const petitionRepo = (ctx.sigilIngestController as any).petitionsRepo;
    const row = await petitionRepo.findById(body.id);

    expect(row).toBeDefined();
    expect(row?.source?.sigilId).toBe(sigilId);
    expect(row?.reporterEmail).toBe("a@b.com");
    expect(row?.status).toBe("pending");
    expect(row?.attachments).toHaveLength(0);
  });

  it("creates a petition with a screenshot attachment", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);

    // Minimal 1×1 PNG (valid PNG header + IHDR + IDAT + IEND)
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const pngBytes = Buffer.from(pngBase64, "base64").toString("binary");

    const res = await postPetition(ctx, sigilId, {
      reporterEmail: "screenshotter@example.com",
      screenshot: {
        name: "screen.png",
        content: pngBytes,
        mimeType: "image/png",
      },
    });
    expect(res.status).toBe(200);

    const body = await res.json();

    const petitionRepo = (ctx.sigilIngestController as any).petitionsRepo;
    const row = await petitionRepo.findById(body.id);

    expect(row?.attachments).toHaveLength(1);
    expect(typeof row?.attachments[0]).toBe("string");
  });

  it("creates a petition without reporterEmail (anonymous path)", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);

    const res = await postPetition(ctx, sigilId, {
      title: "Anonymous bug",
      description: "No email provided",
    });
    expect(res.status).toBe(200);

    const body = await res.json();

    const petitionRepo = (ctx.sigilIngestController as any).petitionsRepo;
    const row = await petitionRepo.findById(body.id);

    // reporterEmail must be absent/null — not coerced to an empty string.
    expect(row?.reporterEmail ?? null).toBeNull();
    expect(row?.source?.sigilId).toBe(sigilId);
  });

  it("returns 404 for an unknown sigil id", async ({ expect }) => {
    const res = await postPetition(ctx, crypto.randomUUID(), {});
    expect(res.status).toBe(404);
  });

  it("returns 403 when features.sigils is off", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner, {
      sigils: false,
      embeddedPetitions: true,
    });
    const sigilId = await createSigil(ctx, campaignId, owner);

    const res = await postPetition(ctx, sigilId, {});
    expect(res.status).toBe(403);
  });

  it("returns 403 when features.embeddedPetitions is off", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner, {
      sigils: true,
      embeddedPetitions: false,
    });
    const sigilId = await createSigil(ctx, campaignId, owner);

    const res = await postPetition(ctx, sigilId, {});
    expect(res.status).toBe(403);
  });

  it("returns 403 when the sigil lacks the petition kind", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    // Sigil with only the beacon kind — no petition capability.
    const sigilId = await createSigil(ctx, campaignId, owner, ["beacon"]);

    const res = await postPetition(ctx, sigilId, {});
    expect(res.status).toBe(403);
  });

  it("stores source.hostUrl and source.hostPath from the request body", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);

    const res = await postPetition(ctx, sigilId, {
      hostUrl: "https://shop.example.com/checkout",
      hostPath: "/checkout",
    });
    expect(res.status).toBe(200);

    const body = await res.json();

    const petitionRepo = (ctx.sigilIngestController as any).petitionsRepo;
    const row = await petitionRepo.findById(body.id);

    expect(row?.source?.hostUrl).toBe("https://shop.example.com/checkout");
    expect(row?.source?.hostPath).toBe("/checkout");
    expect(row?.source?.userAgent).toBe("");
  });

  it("maps the type field to a type= tag", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const sigilId = await createSigil(ctx, campaignId, owner);

    const res = await postPetition(ctx, sigilId, { type: "feature" });
    expect(res.status).toBe(200);

    const body = await res.json();

    const petitionRepo = (ctx.sigilIngestController as any).petitionsRepo;
    const row = await petitionRepo.findById(body.id);

    expect(row?.tags).toContain("type=feature");
  });
});
