import { deflateRawSync } from "node:zlib";

import { describe, it } from "vitest";

import { OtaArchiveWriter } from "../../cli/services/OtaArchiveWriter.ts";
import { OtaEnvelope } from "../../cli/services/OtaEnvelope.ts";
import { OtaBundleInspector } from "../services/OtaBundleInspector.ts";

const envelope = new OtaEnvelope();
const inspector = new OtaBundleInspector();
const writer = new OtaArchiveWriter();
const keys = envelope.generateKeyPair();
const other = envelope.generateKeyPair();
const text = (value: string) => new TextEncoder().encode(value);
const limits = { maxFiles: 100, maxExpandedSize: 1024 * 1024 };

/**
 * Rewrite one byte range of a ZIP the writer made, for the malformed cases a
 * well-behaved writer never produces.
 */
const patch = (
  zip: Uint8Array,
  edit: (view: DataView, bytes: Uint8Array) => void,
): Uint8Array => {
  const copy = zip.slice();
  edit(new DataView(copy.buffer), copy);
  return copy;
};

const centralOffset = (zip: Uint8Array) => {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  return view.getUint32(zip.length - 22 + 16, true);
};

describe("OtaBundleInspector", () => {
  describe("open", () => {
    const zip = writer.write([{ path: "index.html", data: text("<p>ok</p>") }]);

    it("opens a bundle sealed with the app's key", async ({ expect }) => {
      const sealed = envelope.seal(zip, keys.privateKey);
      const opened = await inspector.open({
        ...sealed,
        publicKey: keys.publicKey,
      });
      expect(opened.archive).toEqual(zip);
      expect(opened.archiveSha256).toBe(sealed.archiveSha256);
    });

    it("refuses a bundle sealed with another key", async ({ expect }) => {
      const sealed = envelope.seal(zip, other.privateKey);
      await expect(
        inspector.open({ ...sealed, publicKey: keys.publicKey }),
      ).rejects.toThrow("not encrypted with this app's key");
    });

    it("refuses a modified ciphertext", async ({ expect }) => {
      const sealed = envelope.seal(zip, keys.privateKey);
      const ciphertext = sealed.ciphertext.slice();
      ciphertext[0] ^= 0xff;
      await expect(
        inspector.open({ ...sealed, ciphertext, publicKey: keys.publicKey }),
      ).rejects.toThrow(/does not (match its checksum|decrypt)/);
    });

    it("refuses a checksum sealed for other bytes", async ({ expect }) => {
      const sealed = envelope.seal(zip, keys.privateKey);
      const forged = envelope.seal(
        writer.write([{ path: "index.html", data: text("<p>evil</p>") }]),
        keys.privateKey,
      );
      await expect(
        inspector.open({
          ...sealed,
          checksum: forged.checksum,
          publicKey: keys.publicKey,
        }),
      ).rejects.toThrow("does not match its checksum");
    });

    it("refuses a malformed session key or checksum", async ({ expect }) => {
      const sealed = envelope.seal(zip, keys.privateKey);
      await expect(
        inspector.open({
          ...sealed,
          sessionKey: "nope",
          publicKey: keys.publicKey,
        }),
      ).rejects.toThrow("not '<iv>:<key>'");
      await expect(
        inspector.open({ ...sealed, checksum: "", publicKey: keys.publicKey }),
      ).rejects.toThrow("not hex");
    });
  });

  describe("inspect", () => {
    it("accepts what the publisher writes", async ({ expect }) => {
      const zip = writer.write([
        { path: "index.html", data: text("<p>ok</p>") },
        { path: "assets/app.js", data: text("x".repeat(5000)) },
      ]);
      expect(await inspector.inspect(zip, limits)).toEqual({
        files: 2,
        expandedSize: 5009,
      });
    });

    it("refuses a bundle with no index.html at its root", async ({
      expect,
    }) => {
      const zip = writer.write([{ path: "www/index.html", data: text("x") }]);
      await expect(inspector.inspect(zip, limits)).rejects.toThrow(
        "no index.html",
      );
    });

    it("refuses a path that climbs out of the bundle", async ({ expect }) => {
      const zip = writer.write([
        { path: "index.html", data: text("x") },
        { path: "aa/b.js", data: text("y") },
      ]);
      // "aa/b.js" becomes "../b.js", in the central directory and the local
      // header alike.
      const evil = patch(zip, (_, bytes) => {
        const raw = new TextDecoder("latin1").decode(bytes);
        let at = raw.indexOf("aa/b.js");
        while (at >= 0) {
          bytes.set(text(".."), at);
          at = raw.indexOf("aa/b.js", at + 1);
        }
      });
      await expect(inspector.inspect(evil, limits)).rejects.toThrow(
        "escapes the bundle",
      );
    });

    it("refuses a symlink", async ({ expect }) => {
      const zip = writer.write([
        { path: "index.html", data: text("/etc/passwd") },
      ]);
      const evil = patch(zip, (view) => {
        view.setUint32(centralOffset(zip) + 38, (0o120777 << 16) >>> 0, true);
      });
      await expect(inspector.inspect(evil, limits)).rejects.toThrow("symlink");
    });

    it("refuses an entry that inflates past its declared size", async ({
      expect,
    }) => {
      // A bomb: 1 MiB of zeros declared as 10 bytes.
      const zeros = new Uint8Array(1024 * 1024);
      const deflated = deflateRawSync(zeros);
      const zip = writer.write([{ path: "index.html", data: zeros }]);
      expect(zip.length).toBeLessThan(zeros.length);
      const evil = patch(zip, (view) => {
        view.setUint32(22, 10, true);
        view.setUint32(centralOffset(zip) + 24, 10, true);
      });
      expect(deflated.length).toBeGreaterThan(0);
      await expect(inspector.inspect(evil, limits)).rejects.toThrow(
        "expands past its declared size",
      );
    });

    it("refuses a bundle over the expanded size or file limits", async ({
      expect,
    }) => {
      const zip = writer.write([
        { path: "index.html", data: text("x".repeat(2000)) },
        { path: "a.js", data: text("y") },
      ]);
      await expect(
        inspector.inspect(zip, { maxFiles: 100, maxExpandedSize: 1000 }),
      ).rejects.toThrow("expands past 1000 bytes");
      await expect(
        inspector.inspect(zip, { maxFiles: 1, maxExpandedSize: 1e9 }),
      ).rejects.toThrow("more than 1 files");
    });

    it("refuses an entry whose local header names another method", async ({
      expect,
    }) => {
      const zip = writer.write([
        { path: "index.html", data: text("x".repeat(500)) },
      ]);
      const evil = patch(zip, (view) => view.setUint16(8, 0, true));
      await expect(inspector.inspect(evil, limits)).rejects.toThrow(
        "two compression methods",
      );
    });

    it("refuses a corrupted entry", async ({ expect }) => {
      const zip = writer.write([
        { path: "index.html", data: text("x".repeat(500)) },
      ]);
      const evil = patch(zip, (view) =>
        view.setUint32(centralOffset(zip) + 16, 1, true),
      );
      await expect(inspector.inspect(evil, limits)).rejects.toThrow(
        "size or CRC",
      );
    });

    it("refuses what is not a ZIP", async ({ expect }) => {
      await expect(inspector.inspect(text("hello"), limits)).rejects.toThrow(
        "not a ZIP",
      );
    });
  });
});
