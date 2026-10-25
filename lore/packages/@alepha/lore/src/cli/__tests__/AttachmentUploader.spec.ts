import { Alepha, z } from "alepha";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import {
  AlephaServerLinks,
  AlephaServerLinksClient,
} from "alepha/server/links";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { AttachmentUploader } from "../services/AttachmentUploader.ts";

/**
 * The multipart message is composed by hand here, so it is tested against a
 * real server rather than against a mock that would agree with whatever it
 * produced.
 *
 * That is not a style preference. `$client` cannot be used for the bytes - it
 * materialises the whole file to build a `FormData`, which is the memory cost
 * this command exists to avoid - so the one thing that normally guarantees the
 * call matches the endpoint is absent for exactly those two requests, and a
 * hand-written boundary, header block or CRLF is the kind of mistake that
 * produces a body a lenient parser accepts and a strict one does not.
 *
 * Every case below therefore posts through the network to `$action`s declaring
 * `z.file()`, and asserts what arrived. The sink mirrors the real endpoint
 * NAMES as well as their paths, because the register half of each push does go
 * through `$client` and is resolved by name.
 */
class Sink {
  public uploaded: Array<{
    path: string;
    filename: string;
    type: string;
    bytes: string;
  }> = [];
  public attached: Array<{ questId: number; fileId: string }> = [];
  public registered: Array<{
    projectId: number;
    fileId: string;
    name: string;
    folioId: string;
  }> = [];

  /**
   * Whether the folio the next `getByShortId` answers with is protected.
   */
  public folioProtected = false;

  public uploadAttachment = $action({
    method: "POST",
    path: "/quests/attachments",
    schema: {
      body: z.object({ file: z.file() }),
      response: z.object({ fileId: z.uuid(), url: z.string() }),
    },
    handler: async ({ body }) => {
      const fileId = "11111111-1111-4111-8111-111111111111";
      this.uploaded.push({
        path: "/api/quests/attachments",
        filename: body.file.name,
        type: body.file.type,
        bytes: await body.file.text(),
      });
      return { fileId, url: `/api/files/${fileId}` };
    },
  });

  public uploadFolioAttachment = $action({
    method: "POST",
    path: "/folio/attachments/upload",
    schema: {
      body: z.object({ file: z.file() }),
      response: z.object({ fileId: z.uuid() }),
    },
    handler: async ({ body }) => {
      const fileId = "22222222-2222-4222-8222-222222222222";
      this.uploaded.push({
        path: "/api/folio/attachments/upload",
        filename: body.file.name,
        type: body.file.type,
        bytes: await body.file.text(),
      });
      return { fileId };
    },
  });

  public getQuestByShortId = $action({
    method: "GET",
    path: "/projects/:projectId/quests/:shortId",
    schema: {
      params: z.object({ projectId: z.integer(), shortId: z.integer() }),
      response: z.object({ id: z.integer(), shortId: z.integer() }),
    },
    // The global id is deliberately NOT the shortId: a push that addressed
    // `addAttachment` with the shortId would pass every assertion if they
    // were equal.
    handler: async ({ params }) => ({
      id: params.shortId + 5000,
      shortId: params.shortId,
    }),
  });

  public addAttachment = $action({
    method: "POST",
    path: "/quests/:id/attachments",
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({ fileId: z.uuid() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params, body }) => {
      this.attached.push({ questId: params.id, fileId: body.fileId });
      return { ok: true };
    },
  });

  public listQuestAttachments = $action({
    method: "GET",
    path: "/quests/:id/attachments",
    schema: {
      params: z.object({ id: z.integer() }),
      response: z.array(
        z.object({
          fileId: z.uuid(),
          name: z.string(),
          mimeType: z.string(),
          size: z.integer(),
        }),
      ),
    },
    handler: async () =>
      this.attached.map((it) => ({
        fileId: it.fileId,
        name: "chart.png",
        mimeType: "image/png",
        size: 17,
      })),
  });

  public getByShortId = $action({
    method: "GET",
    path: "/projects/:projectId/folios/:shortId",
    schema: {
      params: z.object({ projectId: z.integer(), shortId: z.integer() }),
      response: z.object({
        id: z.uuid(),
        shortId: z.integer(),
        protected: z.boolean(),
      }),
    },
    handler: async ({ params }) => ({
      id: "33333333-3333-4333-8333-333333333333",
      shortId: params.shortId,
      protected: this.folioProtected,
    }),
  });

  public registerAttachment = $action({
    method: "POST",
    path: "/projects/:projectId/folio/attachments",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        fileId: z.uuid(),
        name: z.string(),
        folioId: z.uuid(),
      }),
      response: z.object({ shortId: z.integer(), name: z.string() }),
    },
    handler: async ({ params, body }) => {
      this.registered.push({ projectId: params.projectId, ...body });
      // Auto-suffixed, the way the real one does on a name already taken.
      return { shortId: 4, name: `${body.name} (1)` };
    },
  });
}

describe("AttachmentUploader", () => {
  /**
   * ⚠️ Two containers, and it has to be two.
   *
   * The sink's port is only knowable after it starts, and `$env` resolves
   * `LORE_URL` when the container holding the uploader boots - so one
   * container cannot both assign the port and read it. It is also the
   * arrangement the real thing has: the CLI's container and the app's
   * container are never the same one.
   */
  const setup = async (content = "a mockup, in bytes") => {
    const server = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaServer)
      // ⚠️ The sink has to publish `/api/_links` as well as serve the two
      // byte endpoints: the register half of each push goes through
      // `$client`, which resolves an action by NAME against that registry.
      .with(AlephaServerLinks)
      .with(Sink);

    await server.start();

    const cli = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "lore_secret",
        LORE_URL: server.inject(ServerProvider).hostname,
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with(AlephaServerLinksClient)
      .with(AttachmentUploader);

    await cli.start();

    const fs = cli.inject(MemoryFileSystemProvider);
    await fs.writeFile("/repo/chart.png", content);

    return {
      server,
      cli,
      sink: server.inject(Sink),
      uploader: cli.inject(AttachmentUploader),
    };
  };

  describe("a quest", () => {
    it("streams the file, then records it on the quest by its GLOBAL id", async () => {
      const ctx = await setup();

      const pushed = await ctx.uploader.pushToQuest({
        projectId: 7,
        questShortId: 1208,
        filePath: "/repo/chart.png",
      });

      expect(ctx.sink.uploaded).toEqual([
        {
          path: "/api/quests/attachments",
          filename: "chart.png",
          type: "image/png",
          bytes: "a mockup, in bytes",
        },
      ]);
      // 1208 + 5000: the shortId was resolved rather than passed through.
      expect(ctx.sink.attached).toEqual([
        { questId: 6208, fileId: "11111111-1111-4111-8111-111111111111" },
      ]);
      expect(pushed).toMatchObject({
        name: "chart.png",
        mimeType: "image/png",
        subject: "quest #Q1208",
      });
    });

    /**
     * The bytes must arrive byte for byte: a CRLF miscounted around the file
     * part would corrupt a PNG while leaving the request perfectly valid.
     */
    it("delivers bytes that span several chunks unchanged", async () => {
      const content = "0123456789".repeat(50_000);
      const ctx = await setup(content);

      await ctx.uploader.pushToQuest({
        projectId: 7,
        questShortId: 1208,
        filePath: "/repo/chart.png",
      });

      expect(ctx.sink.uploaded[0]?.bytes).toBe(content);
    });

    it("delivers an empty file without malforming the message", async () => {
      const ctx = await setup("");

      await ctx.uploader.pushToQuest({
        projectId: 7,
        questShortId: 1208,
        filePath: "/repo/chart.png",
      });

      expect(ctx.sink.uploaded[0]?.bytes).toBe("");
      expect(ctx.sink.uploaded[0]?.filename).toBe("chart.png");
    });

    it("sends --name and --type instead of the file's own", async () => {
      const ctx = await setup();

      await ctx.uploader.pushToQuest({
        projectId: 7,
        questShortId: 1208,
        filePath: "/repo/chart.png",
        name: "hero.html",
        type: "text/html",
      });

      expect(ctx.sink.uploaded[0]).toMatchObject({
        filename: "hero.html",
        type: "text/html",
      });
    });
  });

  describe("a folio", () => {
    it("streams the file, then registers it under the folio's uuid", async () => {
      const ctx = await setup();

      const pushed = await ctx.uploader.pushToFolio({
        projectId: 7,
        folioShortId: 12,
        filePath: "/repo/chart.png",
      });

      expect(ctx.sink.uploaded[0]?.path).toBe("/api/folio/attachments/upload");
      expect(ctx.sink.registered).toEqual([
        {
          projectId: 7,
          fileId: "22222222-2222-4222-8222-222222222222",
          name: "chart.png",
          folioId: "33333333-3333-4333-8333-333333333333",
        },
      ]);
      // ⚠️ The STORED name, not the requested one: `register` auto-suffixes a
      // name already taken on the folio, and the `assets/` reference has to
      // carry what was actually stored.
      expect(pushed.name).toBe("chart.png (1)");
      expect(pushed.path).toBe("assets/chart.png%20(1)");
    });

    it("refuses a protected folio before a byte is sent", async () => {
      const ctx = await setup();
      ctx.sink.folioProtected = true;

      await expect(
        ctx.uploader.pushToFolio({
          projectId: 7,
          folioShortId: 12,
          filePath: "/repo/chart.png",
        }),
      ).rejects.toThrow(/protected/);

      expect(ctx.sink.uploaded).toEqual([]);
      expect(ctx.sink.registered).toEqual([]);
    });
  });

  /**
   * A quote or a newline inside the `Content-Disposition` line ends the field
   * or the part, so a name carrying one would compose a message saying
   * something other than what the caller asked - silently. Refused before it
   * is written rather than discovered by the receiver.
   */
  it("refuses a name that could break the message", async () => {
    const ctx = await setup();

    await expect(
      ctx.uploader.pushToQuest({
        projectId: 7,
        questShortId: 1208,
        filePath: "/repo/chart.png",
        name: 'evil"\r\nContent-Disposition: form-data; name="other"\r\n\r\nx',
      }),
    ).rejects.toThrow(/line break/);

    expect(ctx.sink.uploaded).toEqual([]);
  });

  it("refuses a --type that is not a media type", async () => {
    const ctx = await setup();

    await expect(
      ctx.uploader.pushToQuest({
        projectId: 7,
        questShortId: 1208,
        filePath: "/repo/chart.png",
        type: "not a media type",
      }),
    ).rejects.toThrow(/media type/);

    expect(ctx.sink.uploaded).toEqual([]);
  });

  /**
   * The floor `FileDetector` answers with, asserted here rather than taken on
   * trust: an unknown extension must still compose a valid part.
   */
  it("falls back to application/octet-stream for an unknown extension", async () => {
    const ctx = await setup();
    const fs = ctx.cli.inject(MemoryFileSystemProvider);
    await fs.writeFile("/repo/probe.zzz", "opaque");

    await ctx.uploader.pushToQuest({
      projectId: 7,
      questShortId: 1208,
      filePath: "/repo/probe.zzz",
    });

    expect(ctx.sink.uploaded[0]).toMatchObject({
      filename: "probe.zzz",
      type: "application/octet-stream",
    });
  });
});
