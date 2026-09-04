import { Alepha } from "alepha";
import { FileService } from "alepha/api/files";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { QuestTools } from "../src/mcp/tools/QuestTools.ts";
import { ReadCounter } from "./fixtures/ReadCounter.ts";

/**
 * The incident this closes: the owner attached a screenshot to a quest and the
 * agent working it could not see the file, or even know it was there.
 *
 * Same identity-injection shim as `quest-tools-comments.spec.ts`.
 */

// 1x1 transparent PNG.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// The file this surface was reopened for: an agent writes the mockup, the
// next agent reads it, the owner downloads it and opens it locally.
const MOCKUP_HTML =
  "<!doctype html><title>Mockup</title><main><h1>Quest board</h1></main>";

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
  alepha.with(ReadCounter);

  const counter = alepha.inject(ReadCounter);
  const questTools = alepha.inject(QuestTools);
  const questApi = alepha.inject(QuestController);
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

  // mirrors quest-tools-comments.spec.ts's own tool-execute helper
  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  const project = await asUser(OWNER, () =>
    projectApi.createProject({ body: { title: "Test" } } as any),
  );

  const quest = await call(questTools.quest_create, {
    project: project.id,
    title: "Wire the pipeline",
    description: "x",
    area: "core",
    priority: "medium",
  });

  /**
   * Upload a file and hang it off the quest, the way the UI does: one call to
   * put the bytes in storage, a second to record the id on the quest.
   */
  const attach = async (
    name: string,
    type: string,
    bytes: Buffer,
    questId = quest.id,
  ): Promise<string> => {
    const uploaded = await asUser(OWNER, () =>
      questApi.uploadAttachment({
        // Re-wrapped so the part is an `ArrayBuffer`-backed view: a bare
        // `Buffer` is `ArrayBufferLike` and does not satisfy `BlobPart`.
        body: { file: new File([new Uint8Array(bytes)], name, { type }) },
      } as any),
    );
    await asUser(OWNER, () =>
      questApi.addAttachment({
        params: { id: questId },
        body: { fileId: uploaded.fileId },
      }),
    );
    return uploaded.fileId;
  };

  return {
    alepha,
    counter,
    questTools,
    questApi,
    project,
    quest,
    call,
    asUser,
    attach,
    OWNER,
  };
};

describe("Lore MCP: quest attachments", () => {
  it("quest_get lists nothing, and quest_list counts zero, on a bare quest", async () => {
    const { questTools, project, quest, call } = await setup();

    const res = await call(questTools.quest_get, { id: quest.id });
    expect(res.attachments).toEqual([]);

    const list = await call(questTools.quest_list, { project: project.id });
    expect(list.quests[0].attachmentCount).toBe(0);
  });

  it("quest_get lists an attachment and quest_attachment_get returns it as an image block", async () => {
    const { questTools, project, quest, call, attach } = await setup();

    const fileId = await attach("screenshot.png", "image/png", PNG_BYTES);

    const res = await call(questTools.quest_get, { id: quest.id });
    expect(res.attachments).toHaveLength(1);
    expect(res.attachments[0]).toMatchObject({
      id: fileId,
      name: "screenshot.png",
      mimeType: "image/png",
    });
    expect(res.attachments[0].size).toBeGreaterThan(0);

    const list = await call(questTools.quest_list, { project: project.id });
    expect(list.quests[0].attachmentCount).toBe(1);

    // The point of the whole quest: bytes an agent can actually look at.
    const opened = await call(questTools.quest_attachment_get, {
      id: quest.id,
      attachmentId: fileId,
    });
    expect(opened.content).toHaveLength(1);
    expect(opened.content[0].type).toBe("image");
    expect(opened.content[0].mimeType).toBe("image/png");
    expect(Buffer.from(opened.content[0].data, "base64")).toEqual(PNG_BYTES);
  });

  it("decodes a text-like attachment inline", async () => {
    const { questTools, quest, call, attach } = await setup();

    const fileId = await attach(
      "probe.txt",
      "text/plain",
      Buffer.from("p75 = 118ms", "utf8"),
    );

    const opened = await call(questTools.quest_attachment_get, {
      id: quest.id,
      attachmentId: fileId,
    });
    expect(opened.content[0].type).toBe("text");
    expect(opened.content[0].text).toContain("p75 = 118ms");
  });

  it("quest_attachment_add round-trips a png through quest_attachment_get", async () => {
    const { questTools, quest, call } = await setup();

    const added = await call(questTools.quest_attachment_add, {
      id: quest.id,
      name: "p75-after.png",
      mimeType: "image/png",
      data: PNG_BYTES.toString("base64"),
    });
    expect(added.name).toBe("p75-after.png");
    expect(added.mimeType).toBe("image/png");
    expect(added.size).toBe(PNG_BYTES.byteLength);

    const opened = await call(questTools.quest_attachment_get, {
      id: quest.id,
      attachmentId: added.id,
    });
    expect(opened.content[0].type).toBe("image");
    expect(Buffer.from(opened.content[0].data, "base64")).toEqual(PNG_BYTES);

    // And it is listed, so the agent that wrote it can point at it.
    const res = await call(questTools.quest_get, { id: quest.id });
    expect(res.attachments.map((a: any) => a.id)).toEqual([added.id]);
  });

  it("round-trips an HTML mockup, decoded on the way back", async () => {
    const { questTools, quest, call } = await setup();

    const added = await call(questTools.quest_attachment_add, {
      id: quest.id,
      name: "Mockup.html",
      mimeType: "text/html",
      data: Buffer.from(MOCKUP_HTML, "utf8").toString("base64"),
    });
    expect(added.mimeType).toBe("text/html");

    const opened = await call(questTools.quest_attachment_get, {
      id: quest.id,
      attachmentId: added.id,
    });
    expect(opened.content[0].type).toBe("text");
    expect(opened.content[0].text).toContain("<h1>Quest board</h1>");
  });

  it("takes a type it cannot render inline, and says so on read", async () => {
    const { questTools, quest, call } = await setup();

    // This used to be "refuses a type it could not read back": the tool held
    // an eight-type allowlist so that everything an agent could attach, an
    // agent could also read. It cost the quest the files it is worked from
    // to buy a property nobody needed, since an agent attaching a zip knows
    // it attached a zip and the human on the other end is who opens it.
    const added = await call(questTools.quest_attachment_add, {
      id: quest.id,
      name: "bundle.zip",
      mimeType: "application/zip",
      data: PNG_BYTES.toString("base64"),
    });
    expect(added.mimeType).toBe("application/zip");

    const opened = await call(questTools.quest_attachment_get, {
      id: quest.id,
      attachmentId: added.id,
    });
    expect(opened.content[0].text).toContain("not inline-viewable");
  });

  it("refuses a mimeType that is not a media type", async () => {
    const { questTools, quest, call } = await setup();

    // The shape is checked because this value is stored and later handed
    // back as the download's `Content-Type`. A header separator in it has
    // no business reaching storage.
    await expect(
      call(questTools.quest_attachment_add, {
        id: quest.id,
        name: "Mockup.html",
        mimeType: "text/html\r\nX-Injected: 1",
        data: Buffer.from(MOCKUP_HTML, "utf8").toString("base64"),
      }),
    ).rejects.toThrowError(/not a media type/i);
  });

  it("refuses a payload that is not base64", async () => {
    const { questTools, quest, call } = await setup();

    await expect(
      call(questTools.quest_attachment_add, {
        id: quest.id,
        name: "notes.txt",
        mimeType: "text/plain",
        data: "this is not base64!!",
      }),
    ).rejects.toThrowError(/not valid base64/i);
  });

  it("accepts an attachment on a completed quest", async () => {
    const { questTools, project, call } = await setup();

    const closed = await call(questTools.quest_create, {
      project: project.id,
      title: "Already shipped",
      description: "x",
      area: "core",
      priority: "medium",
      accept: true,
    });
    await call(questTools.quest_complete, { id: closed.id, message: "done" });

    // Evidence arrives at the end, which is the whole reason this is
    // allowed where every other write on a completed quest is not.
    const added = await call(questTools.quest_attachment_add, {
      id: closed.id,
      name: "proof.png",
      mimeType: "image/png",
      data: PNG_BYTES.toString("base64"),
    });
    expect(added.id).toBeTruthy();
  });

  it("refuses a file id that is not on this quest", async () => {
    const { questTools, project, quest, call, attach } = await setup();

    // A second quest in the same project, carrying the file. Reading it
    // through the FIRST quest must 404, or the tool is a way to
    // enumerate files by id through any quest the caller can see.
    const other = await call(questTools.quest_create, {
      project: project.id,
      title: "Elsewhere",
      description: "x",
      area: "core",
      priority: "medium",
    });
    const fileId = await attach(
      "elsewhere.png",
      "image/png",
      PNG_BYTES,
      other.id,
    );

    await expect(
      call(questTools.quest_attachment_get, {
        id: quest.id,
        attachmentId: fileId,
      }),
    ).rejects.toThrowError(/not found on this quest/i);
  });
});

/**
 * The HTTP list behind `QuestAttachments.tsx`, which used to resolve one
 * file per `getFileById` — a D1 round trip each.
 *
 * Two properties of that loop had to survive the batching, and neither is
 * visible in the value it returns on the happy path: the ORDER is the
 * owner's attach order, and a row that outlived its blob is skipped rather
 * than taking the list down with it.
 */
describe("listQuestAttachments", () => {
  it("lists every attachment in attach order, in one read", async () => {
    const { questApi, quest, asUser, attach, counter, OWNER } = await setup();

    await attach("first.png", "image/png", PNG_BYTES);
    await attach("second.txt", "text/plain", Buffer.from("hello", "utf8"));
    await attach("third.png", "image/png", PNG_BYTES);

    counter.reset();
    const listed = await asUser(OWNER, () =>
      questApi.listQuestAttachments({ params: { id: quest.id } } as any),
    );

    expect(listed.map((it) => it.name)).toEqual([
      "first.png",
      "second.txt",
      "third.png",
    ]);
    expect(listed[1]).toMatchObject({ mimeType: "text/plain", size: 5 });

    // Three attachments, ONE read of `files`. It was one per attachment.
    expect(counter.of("files")).toBe(1);
  });

  it("skips an attachment whose file row is gone, and keeps the rest", async () => {
    const { alepha, questApi, quest, asUser, attach, OWNER } = await setup();

    await attach("kept.png", "image/png", PNG_BYTES);
    const doomed = await attach("gone.png", "image/png", PNG_BYTES);
    await attach("also-kept.txt", "text/plain", Buffer.from("x", "utf8"));

    // A row can outlive its blob, and vice versa — a purge job or a manual
    // delete. The id stays on the quest either way.
    await alepha.inject(FileService).fileRepository.deleteById(doomed);

    const listed = await asUser(OWNER, () =>
      questApi.listQuestAttachments({ params: { id: quest.id } } as any),
    );

    // Absent from the batched result set has to mean exactly what the old
    // per-file `catch` meant: drop that one, keep the order of the others.
    expect(listed.map((it) => it.name)).toEqual(["kept.png", "also-kept.txt"]);
  });

  it("answers an empty list without reading anything", async () => {
    const { questApi, quest, asUser, counter, OWNER } = await setup();

    counter.reset();
    const listed = await asUser(OWNER, () =>
      questApi.listQuestAttachments({ params: { id: quest.id } } as any),
    );

    // `inArray: []` throws, so a quest with no attachments must return
    // before the query rather than passing it an empty list.
    expect(listed).toEqual([]);
    expect(counter.of("files")).toBe(0);
  });
});
