import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { PetitionController } from "../src/api/controllers/PetitionController.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

// 1x1 transparent PNG.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  petitionController: PetitionController;
  fakeProvider: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    campaignController: alepha.inject(CampaignController),
    petitionController: alepha.inject(PetitionController),
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
): Promise<number> => {
  const created = await ctx.campaignController.createCampaign.fetch(
    { body: { title: "Attachment Test" } },
    { user },
  );
  return created.data.id;
};

/**
 * Upload a PNG attachment as `user`, then submit a petition that claims it.
 * Returns `{ petitionId, attachmentId }`.
 */
const submitWithAttachment = async (
  ctx: TestContext,
  campaignId: number,
  user: { id: string; roles: string[] },
): Promise<{ petitionId: number; attachmentId: string }> => {
  const upload = await ctx.petitionController.uploadPetitionAttachment.fetch(
    {
      params: { campaignId },
      body: {
        file: new File([PNG_BYTES], "screenshot.png", { type: "image/png" }),
      },
    },
    { user },
  );
  const submitted = await ctx.petitionController.submitPetition.fetch(
    {
      params: { campaignId },
      body: {
        title: "Bug with a screenshot",
        description: "See attached",
        attachments: [upload.data.id],
      },
    },
    { user },
  );
  return { petitionId: submitted.data.id, attachmentId: upload.data.id };
};

describe("getPetitionAttachment", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("returns the attachment bytes (base64) and metadata to a campaign member", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const { petitionId, attachmentId } = await submitWithAttachment(
      ctx,
      campaignId,
      owner,
    );

    const res = await ctx.petitionController.getPetitionAttachment.fetch(
      { params: { campaignId, petitionId, attachmentId } },
      { user: owner },
    );

    expect(res.data.id).toBe(attachmentId);
    expect(res.data.name).toBe("screenshot.png");
    expect(res.data.mimeType).toBe("image/png");
    // Bytes round-trip exactly.
    expect(Buffer.from(res.data.data, "base64").equals(PNG_BYTES)).toBe(true);
  });

  it("surfaces the attachment via petition_get's attachments list", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const { petitionId, attachmentId } = await submitWithAttachment(
      ctx,
      campaignId,
      owner,
    );

    const detail = await ctx.petitionController.getPetition.fetch(
      { params: { campaignId, petitionId } },
      { user: owner },
    );

    const urls = detail.data.attachmentUrls ?? [];
    expect(urls.map((a) => a.id)).toContain(attachmentId);
    expect(urls[0].mimeType).toBe("image/png");
  });

  it("IDOR guard: 404 when the attachment does not belong to that petition", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);

    // Two petitions, each with its own attachment.
    const first = await submitWithAttachment(ctx, campaignId, owner);
    const second = await submitWithAttachment(ctx, campaignId, owner);

    // Ask for petition #1 but with petition #2's attachment id → must 404.
    const error = await ctx.petitionController.getPetitionAttachment
      .fetch(
        {
          params: {
            campaignId,
            petitionId: first.petitionId,
            attachmentId: second.attachmentId,
          },
        },
        { user: owner },
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
  });

  it("rejects a non-member trying to read an attachment", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const outsider = await createTestUser(ctx);
    const campaignId = await createCampaign(ctx, owner);
    const { petitionId, attachmentId } = await submitWithAttachment(
      ctx,
      campaignId,
      owner,
    );

    const error = await ctx.petitionController.getPetitionAttachment
      .fetch(
        { params: { campaignId, petitionId, attachmentId } },
        { user: outsider },
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    // ensureMember throws 403/404 for non-members — either way, not a 200.
    expect([403, 404]).toContain((error as HttpError).status);
  });
});
