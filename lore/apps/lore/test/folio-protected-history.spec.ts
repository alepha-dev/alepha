import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * Regression guard for the protected-folio confidentiality invariant:
 *
 *   `folio_revisions` never holds a snapshot from a different protection
 *   domain than the folio's current one.
 *
 * Before this fix, flipping a folio to `protected` blanked `searchText` and
 * wiped the outbound links but left every pre-encryption plaintext snapshot
 * in `folio_revisions` — readable by any project member through
 * `GET /folios/:id/history`. Encrypting a folio silently did not protect
 * anything already written.
 */

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  folioController: FolioController;
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
    projectController: alepha.inject(ProjectController),
    folioController: alepha.inject(FolioController),
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

/**
 * Stand-in for a `BrowserCryptoProvider` envelope — opaque to the server.
 */
const ENVELOPE = JSON.stringify({
  v: 1,
  salt: "c2FsdA==",
  iv: "aXY=",
  ct: "Y2lwaGVydGV4dA==",
});

const SECRET = "the launch codes are 0000";

describe("protected folio history (confidentiality)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("purges pre-encryption plaintext snapshots when a folio is encrypted", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Secrets" } },
      { user: owner },
    );

    // Write the folio in the clear, then edit it — two plaintext revisions.
    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: project.data.id,
          title: "Ops runbook",
          content: SECRET,
        },
      },
      { user: owner },
    );
    await ctx.folioController.update.fetch(
      {
        params: { id: folio.data.id },
        body: { content: `${SECRET} (revised)` },
      },
      { user: owner },
    );

    // Now encrypt it — the Encrypt action in the folio view.
    await ctx.folioController.update.fetch(
      {
        params: { id: folio.data.id },
        body: { content: ENVELOPE, protected: true },
      },
      { user: owner },
    );

    const history = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );

    const snapshots = history.data.map((r) => r.contentSnapshot);
    expect(snapshots.some((s) => s.includes(SECRET))).toBe(false);
    // The post-encryption revision itself survives — history is not erased,
    // only the snapshots from the old protection domain.
    expect(snapshots).toContain(ENVELOPE);
  });

  it("purges ciphertext snapshots when a folio is decrypted back to clear", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Secrets" } },
      { user: owner },
    );

    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: project.data.id,
          title: "Ops runbook",
          content: ENVELOPE,
          protected: true,
        },
      },
      { user: owner },
    );

    // Decrypt back to clear.
    await ctx.folioController.update.fetch(
      {
        params: { id: folio.data.id },
        body: { content: SECRET, protected: false },
      },
      { user: owner },
    );

    const history = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );

    const snapshots = history.data.map((r) => r.contentSnapshot);
    expect(snapshots).not.toContain(ENVELOPE);
  });

  it("never restores a plaintext snapshot into a still-protected folio", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Secrets" } },
      { user: owner },
    );

    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: project.data.id,
          title: "Ops runbook",
          content: SECRET,
        },
      },
      { user: owner },
    );
    await ctx.folioController.update.fetch(
      {
        params: { id: folio.data.id },
        body: { content: ENVELOPE, protected: true },
      },
      { user: owner },
    );

    const history = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );

    // Revert to the oldest revision still on file. Whatever that is, the
    // folio must remain decryptable — i.e. it must not end up holding
    // plaintext while still flagged `protected`.
    const oldest = history.data[history.data.length - 1];
    const reverted = await ctx.folioController.revertHistory.fetch(
      { params: { id: folio.data.id, revisionId: oldest!.id } },
      { user: owner },
    );

    if (reverted.data.protected) {
      expect(reverted.data.content).not.toBe(SECRET);
    }
  });

  it("keeps plaintext out of history even when a revision was pinned", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Secrets" } },
      { user: owner },
    );

    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: project.data.id,
          title: "Ops runbook",
          content: SECRET,
        },
      },
      { user: owner },
    );

    const before = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    // Pinned revisions are exempt from the retention sweep — they must NOT
    // be exempt from the protection-domain purge.
    await ctx.folioController.pinHistory.fetch(
      {
        params: { id: folio.data.id, revisionId: before.data[0]!.id },
        body: { pinned: true },
      },
      { user: owner },
    );

    await ctx.folioController.update.fetch(
      {
        params: { id: folio.data.id },
        body: { content: ENVELOPE, protected: true },
      },
      { user: owner },
    );

    const history = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    expect(history.data.some((r) => r.contentSnapshot.includes(SECRET))).toBe(
      false,
    );
  });
});
