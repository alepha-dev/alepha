import { Alepha, z } from "alepha";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import {
  AlephaServerLinks,
  AlephaServerLinksClient,
} from "alepha/server/links";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { AttachmentDownloader } from "../services/AttachmentDownloader.ts";

const MOCKUP = "11111111-1111-4111-8111-111111111111";
const LOG = "22222222-2222-4222-8222-222222222222";
const FOLIO = "33333333-3333-4333-8333-333333333333";

/**
 * The Lore end of `lore attachments pull` (#Q4513), served for real: the two
 * lists the attachment is found in, by NAME as `$client` resolves them, and
 * the one byte URL, `GET /api/files/:id`.
 */
class Sink {
  public authorizations: string[] = [];

  public getByShortId = $action({
    method: "GET",
    path: "/projects/:projectId/folios/:shortId",
    schema: {
      params: z.object({ projectId: z.integer(), shortId: z.integer() }),
      response: z.object({ id: z.uuid(), shortId: z.integer() }),
    },
    handler: async ({ params }) => ({ id: FOLIO, shortId: params.shortId }),
  });

  public listAttachments = $action({
    method: "GET",
    path: "/folios/:folioId/attachments",
    schema: {
      params: z.object({ folioId: z.uuid() }),
      response: z.array(
        z.object({
          id: z.uuid(),
          shortId: z.integer(),
          name: z.string(),
          size: z.number(),
        }),
      ),
    },
    handler: async ({ params }) =>
      params.folioId === FOLIO
        ? [{ id: MOCKUP, shortId: 4, name: "reports-a4-mockup.html", size: 26 }]
        : [],
  });

  public getQuestByShortId = $action({
    method: "GET",
    path: "/projects/:projectId/quests/:shortId",
    schema: {
      params: z.object({ projectId: z.integer(), shortId: z.integer() }),
      response: z.object({ id: z.integer(), shortId: z.integer() }),
    },
    handler: async ({ params }) => ({
      id: params.shortId + 5000,
      shortId: params.shortId,
    }),
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
    handler: async ({ params }) =>
      params.id === 6208
        ? [
            {
              fileId: LOG,
              name: "probe.json",
              mimeType: "application/json",
              size: 14,
            },
          ]
        : [],
  });

  public streamFile = $action({
    method: "GET",
    path: "/files/:id",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.file(),
    },
    handler: async ({ params, headers }) => {
      this.authorizations.push(String(headers.authorization ?? ""));
      return params.id === MOCKUP
        ? new File(["<html>the A4 mockup</html>"], "reports-a4-mockup.html", {
            type: "text/html",
          })
        : new File(['{"p75": 1234}'], "probe.json", {
            type: "application/json",
          });
    },
  });
}

describe("AttachmentDownloader", () => {
  const setup = async () => {
    const server = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaServer)
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
      .with(AttachmentDownloader);
    await cli.start();

    return {
      server,
      cli,
      sink: server.inject(Sink),
      fs: cli.inject(MemoryFileSystemProvider),
      downloader: cli.inject(AttachmentDownloader),
    };
  };

  it("pulls a folio attachment by name, byte for byte, into the current directory", async () => {
    const ctx = await setup();

    const pulled = await ctx.downloader.pullFromFolio({
      projectId: 1,
      folioShortId: 1557,
      ref: "reports-a4-mockup.html",
      root: "/repo",
    });

    expect(pulled).toEqual({
      name: "reports-a4-mockup.html",
      path: "/repo/reports-a4-mockup.html",
      size: 26,
    });
    expect(await ctx.fs.readTextFile("/repo/reports-a4-mockup.html")).toBe(
      "<html>the A4 mockup</html>",
    );
    expect(ctx.sink.authorizations).toEqual(["Bearer lore_secret"]);
    await ctx.cli.stop();
    await ctx.server.stop();
  });

  it("pulls a folio attachment by its shortId, to --out", async () => {
    const ctx = await setup();

    const pulled = await ctx.downloader.pullFromFolio({
      projectId: 1,
      folioShortId: 1557,
      ref: "4",
      root: "/repo",
      out: "mockups/hero.html",
    });

    expect(pulled.path).toBe("/repo/mockups/hero.html");
    expect(await ctx.fs.readTextFile("/repo/mockups/hero.html")).toContain(
      "the A4 mockup",
    );
    await ctx.cli.stop();
    await ctx.server.stop();
  });

  it("pulls a quest attachment by name, a JSON file unparsed, into an --out directory", async () => {
    const ctx = await setup();
    await ctx.fs.mkdir("/tmp/evidence", { recursive: true });

    const pulled = await ctx.downloader.pullFromQuest({
      projectId: 1,
      questShortId: 1208,
      ref: "probe.json",
      root: "/repo",
      out: "/tmp/evidence",
    });

    expect(pulled.path).toBe("/tmp/evidence/probe.json");
    expect(await ctx.fs.readTextFile("/tmp/evidence/probe.json")).toBe(
      '{"p75": 1234}',
    );
    await ctx.cli.stop();
    await ctx.server.stop();
  });

  it("refuses an attachment the folio does not hold, naming the ones it does", async () => {
    const ctx = await setup();

    await expect(
      ctx.downloader.pullFromFolio({
        projectId: 1,
        folioShortId: 1557,
        ref: "missing.png",
        root: "/repo",
      }),
    ).rejects.toThrow("reports-a4-mockup.html (4)");
    await ctx.cli.stop();
    await ctx.server.stop();
  });
});
