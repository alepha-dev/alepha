import { $hook, Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { FileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { $storage, FileService } from "../index.ts";

/**
 * `files:beforeUpload` has no in-framework subscriber — every transform it
 * exists for (resize, re-encode, strip EXIF, scan) drags in a dependency core
 * deliberately does not carry. These stand in for one, so the contract the
 * hook promises is pinned rather than assumed.
 */
class Rewriter {
  public seen: Array<{ bucket: string; size: number }> = [];

  protected readonly onBeforeUpload = $hook({
    on: "files:beforeUpload",
    handler: (ev) => {
      this.seen.push({ bucket: ev.storage.name, size: ev.file.size });
      if (ev.storage.name !== "thumbs") {
        return;
      }
      ev.file = new File(["small"], "small.txt", { type: "text/plain" });
    },
  });
}

class Media {
  thumbs = $storage({ name: "thumbs", provider: "memory" });
  raw = $storage({ name: "raw", provider: "memory" });
}

describe("files:beforeUpload", () => {
  const setup = async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const media = alepha.inject(Media);
    const rewriter = alepha.inject(Rewriter);
    const files = alepha.inject(FileService);
    const fs = alepha.inject(FileSystemProvider);
    await alepha.start();
    return { alepha, media, rewriter, files, fs };
  };

  const file = (content: string) =>
    new File([content], "original.txt", { type: "text/plain" });

  it("stores what the subscriber put on the event, not what the caller sent", async ({
    expect,
  }) => {
    const { media, files } = await setup();

    const stored = await media.thumbs.upload(file("the original bytes"));

    const bytes = await (await files.streamFile(stored.id)).text();
    expect(bytes).toBe("small");
  });

  it("describes the replacement in the row, not the original", async ({
    expect,
  }) => {
    const { media } = await setup();

    // The hook fires ahead of the checksum for exactly this reason: hashing
    // first would pin `size`, `mimeType` and `checksum` to a file nobody can
    // fetch.
    const original = file("the original bytes");
    const stored = await media.thumbs.upload(original);

    expect(stored.size).toBe(5);
    expect(stored.size).not.toBe(original.size);
    expect(stored.name).toBe("small.txt");
  });

  it("stores the original when the subscriber leaves the event alone", async ({
    expect,
  }) => {
    const { media, files } = await setup();

    const stored = await media.raw.upload(file("untouched"));

    expect(await (await files.streamFile(stored.id)).text()).toBe("untouched");
    expect(stored.name).toBe("original.txt");
  });

  it("hands the subscriber the storage it is headed for", async ({
    expect,
  }) => {
    const { media, rewriter } = await setup();

    await media.raw.upload(file("abc"));

    // `storage` is how a subscriber reaches whatever option its own package
    // augmented onto `StoragePrimitiveOptions` — without it the hook could
    // only ever apply one global policy.
    expect(rewriter.seen).toEqual([{ bucket: "raw", size: 3 }]);
  });

  it("fires after the storage's own MIME and size rules", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const app = alepha.inject(
      class Restricted {
        images = $storage({
          name: "images",
          provider: "memory",
          mimeTypes: ["image/png"],
        });
      },
    );
    const rewriter = alepha.inject(Rewriter);
    await alepha.start();

    // A rejected upload must never reach a subscriber — otherwise every
    // transform pays to decode what the storage was always going to refuse.
    await expect(app.images.upload(file("nope"))).rejects.toThrowError();
    expect(rewriter.seen).toEqual([]);
  });
});
