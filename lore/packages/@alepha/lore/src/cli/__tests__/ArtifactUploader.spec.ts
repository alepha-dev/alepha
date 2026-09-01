import { Alepha, z } from "alepha";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { ArtifactUploader } from "../services/ArtifactUploader.ts";

/**
 * The multipart message is composed by hand here, so it is tested against a
 * real server rather than against a mock that would agree with whatever it
 * produced.
 *
 * That is not a style preference. `$client` cannot be used for this upload -
 * it materialises the whole tarball to build a `FormData` - so the one thing
 * that normally guarantees the call matches the endpoint is absent, and a
 * hand-written boundary, header block or CRLF is exactly the kind of mistake
 * that produces a body a lenient parser accepts and a strict one does not.
 *
 * Every case below therefore posts through the network to an `$action`
 * declaring `z.file()` plus scalar fields, and asserts what arrived.
 */
class Sink {
  public received?: {
    app: string;
    tag: string;
    commitSha?: string;
    force?: boolean;
    filename: string;
    bytes: string;
  };

  public push = $action({
    method: "POST",
    path: "/projects/:projectId/artifacts",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        app: z.string(),
        tag: z.string(),
        commitSha: z.string().optional(),
        force: z.boolean().optional(),
        file: z.file(),
      }),
      response: z.object({
        artifact: z.object({
          app: z.string(),
          tag: z.string(),
          runtime: z.string(),
          sha256: z.string(),
          size: z.integer(),
        }),
        stored: z.boolean(),
      }),
    },
    handler: async ({ body }) => {
      this.received = {
        app: body.app,
        tag: body.tag,
        commitSha: body.commitSha,
        force: body.force,
        filename: body.file.name,
        bytes: await body.file.text(),
      };

      return {
        artifact: {
          app: body.app,
          tag: body.tag,
          runtime: "node",
          sha256: "a".repeat(64),
          size: (await body.file.arrayBuffer()).byteLength,
        },
        stored: true,
      };
    },
  });
}

describe("ArtifactUploader", () => {
  /**
   * ⚠️ Two containers, and it has to be two.
   *
   * The sink's port is only knowable after it starts, and `$env` resolves
   * `LORE_URL` when the container holding the uploader boots - so one
   * container cannot both assign the port and read it. Writing
   * `alepha.env.LORE_URL` after `start()` looks like it works and does not:
   * the value is already resolved, so the upload goes to the PUBLIC Lore
   * instead, which answers 404 and makes a wiring mistake look like a routing
   * one.
   *
   * It is also the arrangement the real thing has - the CLI's container and
   * the app's container are never the same one.
   */
  const setup = async (content = "a packed artifact") => {
    const server = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaServer)
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
      .with(ArtifactUploader);

    await cli.start();

    const fs = cli.inject(MemoryFileSystemProvider);
    await fs.writeFile("/repo/my-app-1.2.3.tar.gz", content);

    return {
      server,
      cli,
      sink: server.inject(Sink),
      uploader: cli.inject(ArtifactUploader),
    };
  };

  const upload = async (
    overrides: Partial<Parameters<ArtifactUploader["upload"]>[0]> = {},
    content?: string,
  ) => {
    const ctx = await setup(content);
    const result = await ctx.uploader.upload({
      projectId: 7,
      app: "my-app",
      tag: "1.2.3",
      archivePath: "/repo/my-app-1.2.3.tar.gz",
      filename: "my-app-1.2.3.tar.gz",
      ...overrides,
    });
    return { ...ctx, result };
  };

  it("delivers the scalar fields and the file in one message", async () => {
    const ctx = await upload({ commitSha: "0b35cb375" });

    expect(ctx.sink.received).toMatchObject({
      app: "my-app",
      tag: "1.2.3",
      commitSha: "0b35cb375",
      filename: "my-app-1.2.3.tar.gz",
      bytes: "a packed artifact",
    });
  });

  /**
   * The bytes must arrive byte for byte: a CRLF miscounted around the file
   * part would corrupt an archive while leaving the request perfectly valid,
   * and gzip would only complain later, on the server, about "not a gzip
   * archive".
   */
  it("delivers bytes that span several chunks unchanged", async () => {
    const content = "0123456789".repeat(50_000);
    const ctx = await upload({}, content);

    expect(ctx.sink.received?.bytes).toBe(content);
  });

  it("delivers an empty archive without malforming the message", async () => {
    const ctx = await upload({}, "");

    expect(ctx.sink.received?.bytes).toBe("");
    expect(ctx.sink.received?.app).toBe("my-app");
  });

  /**
   * ⚠️ A boolean in a multipart body is only declarable because the server
   * coerces scalar parts. This is the CLI half of that pair.
   */
  it("sends force as a field the server decodes as a boolean", async () => {
    const ctx = await upload({ force: true });

    expect(ctx.sink.received?.force).toBe(true);
  });

  it("omits force and commitSha rather than sending them empty", async () => {
    const ctx = await upload();

    expect(ctx.sink.received?.force).toBeUndefined();
    expect(ctx.sink.received?.commitSha).toBeUndefined();
  });

  it("returns what the registry answered", async () => {
    const ctx = await upload();

    expect(ctx.result.stored).toBe(true);
    expect(ctx.result.artifact.runtime).toBe("node");
    expect(ctx.result.artifact.sha256).toHaveLength(64);
  });

  /**
   * A quote or a newline inside an unquoted form field ends the field or the
   * part, so a value carrying one would compose a message saying something
   * other than what the caller asked - silently. Refused before it is written
   * rather than discovered by the receiver.
   */
  it("refuses a field value that could break the message", async () => {
    const ctx = await setup();

    await expect(
      ctx.uploader.upload({
        projectId: 7,
        app: "my-app",
        tag: 'evil"\r\nContent-Disposition: form-data; name="force"\r\n\r\ntrue',
        archivePath: "/repo/my-app-1.2.3.tar.gz",
        filename: "my-app-1.2.3.tar.gz",
      }),
    ).rejects.toThrowError(/line break/);

    expect(ctx.sink.received).toBeUndefined();
  });
});
