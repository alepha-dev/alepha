import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { FolioTools } from "../src/mcp/tools/FolioTools.ts";

/**
 * Attaching a file to a folio, as MCP describes it.
 *
 * The folio surface used to be list / rename / delete only: an agent could
 * organize what a human had uploaded but could not put a file there itself,
 * so a diagram or a CSV an agent produced had to be pasted into the body as
 * text or dropped entirely. Quests got a base64 upload first, folios
 * followed, and then the BYTES left both: `folio_attachment_add` now returns
 * the `lore attachments push` line rather than carrying the file, because
 * base64 inside a JSON-RPC frame capped every attachment at 2 MB while this
 * bucket has no ceiling at all.
 *
 * What is left here is the two checks the tool still makes before sending a
 * caller to a shell, and the line it composes. The bytes are covered by
 * `packages/@alepha/lore/src/cli/__tests__/AttachmentUploader.spec.ts`.
 *
 * Same identity-injection shim as `quest-tools-attachments.spec.ts`.
 */

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

  const folioTools = alepha.inject(FolioTools);
  const folioApi = alepha.inject(FolioController);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const OWNER = owner.id;

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  const project = await asUser(OWNER, () =>
    projectApi.createProject({ body: { title: "Test" } } as any),
  );

  const folio = await call(folioTools.folio_create, {
    project: project.id,
    title: "Runtime notes",
    content: "The measurements live here.",
    summary: "Where the p75 numbers are recorded.",
  });

  return { alepha, folioTools, folioApi, project, folio, call, asUser, OWNER };
};

describe("Lore MCP: folio attachments", () => {
  /*
    ⚠️ `folio_attachment_add` moves NO bytes since 2026-09-06. Base64 through
    a JSON-RPC frame capped every attachment at 2 MB while `folioBucket` sets
    no ceiling at all, so the bytes went to `lore attachments push` and the
    tool kept its name, its description and its two checks. The cases that
    went with `AttachmentUploadService` - a media type that is not one, a
    payload that is not base64, a payload over a ceiling that no longer
    exists - are gone with it; the first is checked by the CLI and the other
    two cannot happen any more.

    The auto-suffix is still real, and it now happens where the bytes do:
    `AttachmentUploader.spec.ts` asserts the stored name comes back from
    `register` rather than being echoed.
  */
  it("uploads nothing and answers with the command that does", async () => {
    const { folioTools, project, folio, call } = await setup();

    const answer = await call(folioTools.folio_attachment_add, {
      project: project.id,
      folio_shortId: folio.shortId,
      file: "./p75-after.png",
    });

    expect(answer.command).toBe(
      `lore attachments push ./p75-after.png --project ${project.id} --folio ${folio.shortId}`,
    );
    expect(answer.projectId).toBe(project.id);
    expect(answer.shortId).toBe(folio.shortId);

    // Nothing was stored: the folio has no attachments.
    const listed = await call(folioTools.folio_attachment_list, {
      project: project.id,
      folio_shortId: folio.shortId,
    });
    expect(listed.attachments).toEqual([]);
  });

  it("carries --name through, quoted when a shell would split it", async () => {
    const { folioTools, project, folio, call } = await setup();

    const answer = await call(folioTools.folio_attachment_add, {
      project: project.id,
      folio_shortId: folio.shortId,
      file: "./out/chart.png",
      name: "p75 after.png",
    });

    expect(answer.command).toContain("./out/chart.png");
    expect(answer.command).toContain("--name 'p75 after.png'");
  });

  /**
   * The gap the returned message exists to close: the MCP session is
   * authenticated as the user and a shell is not.
   */
  it("names both ways to authenticate the shell it sends you to", async () => {
    const { folioTools, project, folio, call } = await setup();

    const answer = await call(folioTools.folio_attachment_add, {
      project: project.id,
      folio_shortId: folio.shortId,
      file: "./chart.png",
    });

    expect(answer.authentication).toContain("lore login");
    expect(answer.authentication).toContain("LORE_API_KEY");
  });

  it("refuses a folio that does not exist, rather than sending you to a shell", async () => {
    const { folioTools, project, call } = await setup();

    await expect(
      call(folioTools.folio_attachment_add, {
        project: project.id,
        folio_shortId: 9999,
        file: "./chart.png",
      }),
    ).rejects.toThrow();
  });

  it("refuses a protected folio, the way the editor does", async () => {
    const { folioTools, folioApi, project, call, asUser, OWNER } =
      await setup();

    // A protected folio's `content` is a client-side encryption envelope the
    // server cannot read. The editor hides its upload handler for exactly
    // that reason (`useFolioImageUpload` returns undefined), and a rename
    // there cannot repoint the `assets/` references either. Neither MCP nor
    // the CLI is the door around it - the CLI repeats this refusal rather
    // than relying on it, and `AttachmentUploader.spec.ts` pins that.
    const secret = await asUser(OWNER, () =>
      folioApi.create({
        body: {
          projectId: project.id,
          title: "Sealed",
          protected: true,
          content: "cipher",
        },
      } as any),
    );

    await expect(
      call(folioTools.folio_attachment_add, {
        project: project.id,
        folio_shortId: secret.shortId,
        file: "./leak.png",
      }),
    ).rejects.toThrow(/protected/i);
  });
});
