import { Alepha } from "alepha";
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

  return { questTools, questApi, project, quest, call, asUser, attach, OWNER };
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

  it("refuses a type it could not read back", async () => {
    const { questTools, quest, call } = await setup();

    await expect(
      call(questTools.quest_attachment_add, {
        id: quest.id,
        name: "bundle.zip",
        mimeType: "application/zip",
        data: PNG_BYTES.toString("base64"),
      }),
    ).rejects.toThrowError(/not accepted here/i);
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
