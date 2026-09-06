import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { feedbackOptionsAtom } from "../src/api/atoms/feedbackOptionsAtom.ts";
import { FeedbackController } from "../src/api/controllers/FeedbackController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * The feedback list stopped answering in production on 2026-09-02, with a
 * bare `Query select has failed`, because `toResources` binds every
 * attachment id of every row it returns into one statement and Cloudflare
 * D1 refuses past 100 bound parameters. Project 1 had crossed 100.
 *
 * ⚠️ These specs run on in-memory SQLite, whose ceiling is far above 100, so
 * they cannot reproduce the driver refusal - a 120-parameter statement runs
 * here whether or not it is chunked. What they DO pin is the half that a
 * chunked read can get wrong silently: the merge. A listing that crosses the
 * chunk boundary must still carry every attachment, once each, on the right
 * row. `BoundParameters.spec.ts` pins the bound itself.
 */

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Three rows of 40 attachments: 120 ids in one listing, so the read is two
 * batches at the real limit of 90 rather than one.
 */
const ROWS = 3;
const PER_ROW = 40;

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  feedbackController: FeedbackController;
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

  // The production caps (5 feedback and 50 attachments per user per day) are
  // below what this fixture needs, and they are not what is under test.
  const options = alepha.store.get(feedbackOptionsAtom);
  alepha.store.set(feedbackOptionsAtom, {
    ...options,
    maxFeedbackPerUserPerDay: ROWS + 1,
    maxAttachmentsPerUserPerDay: ROWS * PER_ROW + 1,
    maxAttachmentsPerFeedback: PER_ROW,
  });

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    feedbackController: alepha.inject(FeedbackController),
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

describe("feedback attachments past the D1 parameter ceiling", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("lists accepted and all when the listing carries more than 100 attachment ids", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = (
      await ctx.projectController.createProject.fetch(
        {
          body: {
            title: "Ceiling",
            capabilities: [{ key: "support" as const }],
          },
        },
        { user: owner },
      )
    ).data.id;

    const expected = new Map<number, string[]>();
    for (let row = 0; row < ROWS; row++) {
      const attachments: string[] = [];
      for (let i = 0; i < PER_ROW; i++) {
        const upload =
          await ctx.feedbackController.uploadFeedbackAttachment.fetch(
            {
              params: { projectId },
              body: {
                file: new File([PNG_BYTES], `shot-${row}-${i}.png`, {
                  type: "image/png",
                }),
              },
            },
            { user: owner },
          );
        attachments.push(upload.data.id);
      }
      const submitted = await ctx.feedbackController.submitFeedback.fetch(
        {
          params: { projectId },
          body: {
            title: `Report ${row}`,
            description: "See attached",
            attachments,
          },
        },
        { user: owner },
      );
      expected.set(submitted.data.id, attachments);
      await ctx.feedbackController.acceptFeedback.fetch(
        { params: { projectId, feedbackId: submitted.data.id } },
        { user: owner },
      );
    }

    const allIds = [...expected.values()].flat();
    expect(allIds.length).toBeGreaterThan(100);

    for (const status of ["accepted", "all"] as const) {
      const listed = await ctx.feedbackController.listFeedback.fetch(
        { params: { projectId }, query: { status } },
        { user: owner },
      );

      expect(listed.data.items.length).toBe(ROWS);

      // Every attachment resolved, once, on the row that owns it: the merge
      // across chunks neither drops a batch nor cross-wires two rows.
      for (const item of listed.data.items) {
        const urls = item.attachmentUrls ?? [];
        expect(urls.map((a) => a.id).sort()).toEqual(
          [...(expected.get(item.id) ?? [])].sort(),
        );
        expect(urls.every((a) => a.url === `/api/files/${a.id}`)).toBe(true);
        expect(urls.every((a) => a.mimeType === "image/png")).toBe(true);
      }
    }
  });

  it("resolves a feedback shortId without listing the project", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = (
      await ctx.projectController.createProject.fetch(
        {
          body: {
            title: "Resolve",
            capabilities: [{ key: "support" as const }],
          },
        },
        { user: owner },
      )
    ).data.id;

    const submit = async (title: string) => {
      const created = await ctx.feedbackController.submitFeedback.fetch(
        { params: { projectId }, body: { title, description: title } },
        { user: owner },
      );
      // `submitFeedback` answers with the global id only, so the per-project
      // shortId comes back from the detail read.
      const detail = await ctx.feedbackController.getFeedback.fetch(
        { params: { projectId, feedbackId: created.data.id } },
        { user: owner },
      );
      return { id: created.data.id, shortId: detail.data.shortId };
    };

    const first = await submit("One");
    const second = await submit("Two");

    // The MCP tools used to list every feedback in the project and scan the
    // result, which dragged `toResources` - and its attachment lookup - into
    // resolving one integer.
    expect(
      await ctx.feedbackController.resolveShortId(projectId, second.shortId),
    ).toBe(second.id);
    expect(
      await ctx.feedbackController.resolveShortId(projectId, first.shortId),
    ).toBe(first.id);
    expect(
      await ctx.feedbackController.resolveShortId(projectId, 9999),
    ).toBeUndefined();
  });
});
