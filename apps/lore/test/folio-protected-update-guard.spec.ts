import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * Regression guard for a server-side gap found while reviewing the folio
 * workspace's new client-side Save action (Task 7 of the folio-editor
 * workspace plan): the client refuses to write `content` to a protected
 * folio, but that refusal is a client-side snapshot only. A stale tab —
 * or any caller that does not know a folio is protected — could still
 * send `content` with `protected` omitted from the body, and
 * `FolioController.update` would happily write it: `content` falls back
 * to `body.content` and `isProtected` falls back to `existing.protected`,
 * so the write lands as plaintext `content` on a row still flagged
 * `protected: true`. That crosses the protection-domain boundary
 * described in apps/lore/CLAUDE.md ("Protected folios") without ever
 * triggering `purgeRevisions` — the ciphertext is gone, a plaintext
 * revision snapshot is appended to `folio_revisions`, and the folio is
 * left undecryptable, all silently.
 *
 * The fix requires the caller to explicitly assert `protected` whenever
 * it writes `content` against a currently-protected row. `protected:
 * true` (stay protected, re-encrypt in place) and `protected: false`
 * (explicit removal of protection) both remain legitimate and allowed —
 * only the omitted case, the one a naive/stale caller produces, is
 * refused.
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

/** Stand-in for a `BrowserCryptoProvider` envelope — opaque to the server. */
const ENVELOPE = JSON.stringify({
  v: 1,
  salt: "c2FsdA==",
  iv: "aXY=",
  ct: "Y2lwaGVydGV4dA==",
});

const STALE_PLAINTEXT = "a stale tab's plaintext buffer";

describe("FolioController.update protected-content guard", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("rejects a content write against a protected folio when `protected` is omitted", async ({
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

    // `.fetch()` round-trips through the HTTP layer, so the rejection
    // surfaces as the generic `HttpError` the client sees, not the
    // original `BadRequestError` subclass — `project-leave.spec.ts` pins
    // the same pattern. `error` carries the original class name; `status`
    // the HTTP code.
    await expect(
      ctx.folioController.update.fetch(
        {
          params: { id: folio.data.id },
          // `protected` deliberately omitted — the stale-tab / naive-client
          // shape that must be refused.
          body: { content: STALE_PLAINTEXT },
        },
        { user: owner },
      ),
    ).rejects.toThrow(HttpError);

    try {
      await ctx.folioController.update.fetch(
        { params: { id: folio.data.id }, body: { content: STALE_PLAINTEXT } },
        { user: owner },
      );
      expect.unreachable("expected the guard to reject this request");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(400);
      expect((err as HttpError).error).toBe("BadRequestError");
    }

    // The row must be untouched — still protected, still holding the
    // original ciphertext, not the rejected plaintext.
    const reread = await ctx.folioController.get.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    expect(reread.data.protected).toBe(true);
    expect(reread.data.content).toBe(ENVELOPE);
  });

  it("allows a content write against a protected folio when `protected: true` is asserted", async ({
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

    const NEW_ENVELOPE = JSON.stringify({
      v: 1,
      salt: "c2FsdA==",
      iv: "aXY=",
      ct: "cmUtZW5jcnlwdGVk",
    });

    const updated = await ctx.folioController.update.fetch(
      {
        params: { id: folio.data.id },
        body: { content: NEW_ENVELOPE, protected: true },
      },
      { user: owner },
    );

    expect(updated.data.protected).toBe(true);
    expect(updated.data.content).toBe(NEW_ENVELOPE);
  });

  it("leaves a clear folio's content writes unaffected", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Notes" } },
      { user: owner },
    );

    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: project.data.id,
          title: "Ops runbook",
          content: "hello",
        },
      },
      { user: owner },
    );

    // `protected` omitted, exactly like the guard-triggering shape above —
    // but the row is not protected, so this must succeed as always.
    const updated = await ctx.folioController.update.fetch(
      {
        params: { id: folio.data.id },
        body: { content: "hello (revised)" },
      },
      { user: owner },
    );

    expect(updated.data.protected).toBe(false);
    expect(updated.data.content).toBe("hello (revised)");
  });

  it("still allows the explicit clear -> protected transition and purges history", async ({
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
          content: "hello",
        },
      },
      { user: owner },
    );

    const updated = await ctx.folioController.update.fetch(
      {
        params: { id: folio.data.id },
        body: { content: ENVELOPE, protected: true },
      },
      { user: owner },
    );
    expect(updated.data.protected).toBe(true);
    expect(updated.data.content).toBe(ENVELOPE);

    const history = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    expect(history.data.some((r) => r.contentSnapshot.includes("hello"))).toBe(
      false,
    );
  });

  it("still allows the explicit protected -> clear transition and purges history", async ({
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

    const updated = await ctx.folioController.update.fetch(
      {
        params: { id: folio.data.id },
        body: { content: "decrypted at last", protected: false },
      },
      { user: owner },
    );
    expect(updated.data.protected).toBe(false);
    expect(updated.data.content).toBe("decrypted at last");

    const history = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    expect(history.data.some((r) => r.contentSnapshot === ENVELOPE)).toBe(
      false,
    );
  });
});
