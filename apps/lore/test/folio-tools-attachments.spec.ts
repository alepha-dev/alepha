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
 * Uploading a folio attachment over MCP.
 *
 * The folio surface used to be list / rename / delete only: an agent could
 * organize what a human had uploaded but could not put a file there itself,
 * so a diagram or a CSV an agent produced had to be pasted into the body as
 * text or dropped entirely. Quests got the base64 upload first
 * (`quest-tools-attachments.spec.ts`); this is the same channel for folios,
 * with the folio's own placement rules on top.
 *
 * Same identity-injection shim as `quest-tools-attachments.spec.ts`.
 */

// 1x1 transparent PNG.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

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
  it("folio_attachment_add stores the bytes and folio_attachment_list finds them", async () => {
    const { folioTools, project, folio, call } = await setup();

    const added = await call(folioTools.folio_attachment_add, {
      project: project.id,
      folio_shortId: folio.shortId,
      name: "p75-after.png",
      mimeType: "image/png",
      data: PNG_BYTES.toString("base64"),
    });

    expect(added.name).toBe("p75-after.png");
    expect(added.mimeType).toBe("image/png");
    expect(added.size).toBe(PNG_BYTES.byteLength);
    expect(added.shortId).toBeGreaterThan(0);
    // The reference the agent has to write into the body for the file to
    // render — the whole point of uploading it from an agent.
    expect(added.path).toBe("assets/p75-after.png");

    const listed = await call(folioTools.folio_attachment_list, {
      project: project.id,
      folio_shortId: folio.shortId,
    });
    expect(listed.attachments).toHaveLength(1);
    expect(listed.attachments[0]).toMatchObject({
      shortId: added.shortId,
      name: "p75-after.png",
      mimeType: "image/png",
      size: PNG_BYTES.byteLength,
    });
  });

  it("auto-suffixes a name already taken on the same folio", async () => {
    const { folioTools, project, folio, call } = await setup();

    const params = {
      project: project.id,
      folio_shortId: folio.shortId,
      name: "chart.png",
      mimeType: "image/png",
      data: PNG_BYTES.toString("base64"),
    };
    await call(folioTools.folio_attachment_add, params);
    const second = await call(folioTools.folio_attachment_add, params);

    // `register` renames on collision, so the tool must report the name the
    // file actually got — an agent that echoed its own input would write a
    // reference to a file that is not there.
    expect(second.name).toBe("chart (1).png");
    expect(second.path).toBe("assets/chart%20%281%29.png");
  });

  it("refuses a mimeType that is not a media type", async () => {
    const { folioTools, project, folio, call } = await setup();

    await expect(
      call(folioTools.folio_attachment_add, {
        project: project.id,
        folio_shortId: folio.shortId,
        name: "notes.html",
        mimeType: "text/html\r\nX-Injected: 1",
        data: PNG_BYTES.toString("base64"),
      }),
    ).rejects.toThrowError(/not a media type/i);
  });

  it("refuses a payload that is not base64", async () => {
    const { folioTools, project, folio, call } = await setup();

    await expect(
      call(folioTools.folio_attachment_add, {
        project: project.id,
        folio_shortId: folio.shortId,
        name: "notes.txt",
        mimeType: "text/plain",
        data: "this is not base64!!",
      }),
    ).rejects.toThrowError(/not valid base64/i);
  });

  it("refuses a payload over the size ceiling", async () => {
    const { folioTools, project, folio, call } = await setup();

    await expect(
      call(folioTools.folio_attachment_add, {
        project: project.id,
        folio_shortId: folio.shortId,
        name: "huge.bin",
        mimeType: "application/octet-stream",
        data: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"),
      }),
    ).rejects.toThrowError(/byte limit/i);
  });

  it("refuses a protected folio, the way the editor does", async () => {
    const { folioTools, folioApi, project, call, asUser, OWNER } =
      await setup();

    // A protected folio's `content` is a client-side encryption envelope the
    // server cannot read. The editor hides its upload handler for exactly
    // that reason (`useFolioImageUpload` returns undefined), and a rename
    // there cannot repoint the `assets/` references either. MCP must not be
    // the door around it.
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
        name: "leak.png",
        mimeType: "image/png",
        data: PNG_BYTES.toString("base64"),
      }),
    ).rejects.toThrowError(/protected/i);
  });
});
