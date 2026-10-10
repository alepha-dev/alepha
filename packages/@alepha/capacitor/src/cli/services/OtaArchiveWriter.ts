import { crc32, deflateRawSync } from "node:zlib";

import { AlephaError } from "alepha";

/**
 * Writes the ZIP a live update ships: the app shell's public files, with
 * `index.html` at the root, deflated.
 *
 * A plain ZIP and nothing more, what the pinned updater's own reader takes
 * (stored and deflate entries): no directories (the device creates them), no
 * symlinks, no ZIP64 (a bundle past 4 GiB is refused long before), no data
 * descriptors, UTF-8 names, and one fixed timestamp so the same files make
 * the same archive.
 */
export class OtaArchiveWriter {
  /**
   * 1980-01-01 00:00, the first instant a ZIP can name.
   */
  protected static readonly DOS_DATE = 0x21;
  protected static readonly DOS_TIME = 0;

  public write(files: OtaArchiveFile[]): Uint8Array {
    const sorted = [...files].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;

    for (const file of sorted) {
      const name = Buffer.from(this.check(file.path), "utf-8");
      const data = Buffer.from(file.data);
      const deflated = deflateRawSync(data, { level: 9 });
      const stored = deflated.length >= data.length;
      const body = stored ? data : deflated;
      const crc = crc32(data);

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(stored ? 0 : 8, 8);
      local.writeUInt16LE(OtaArchiveWriter.DOS_TIME, 10);
      local.writeUInt16LE(OtaArchiveWriter.DOS_DATE, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);

      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      // Made by Unix (3), version 2.0: the external attributes below are a
      // Unix mode, a regular file readable by all.
      central.writeUInt16LE((3 << 8) | 20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0x0800, 8);
      central.writeUInt16LE(stored ? 0 : 8, 10);
      central.writeUInt16LE(OtaArchiveWriter.DOS_TIME, 12);
      central.writeUInt16LE(OtaArchiveWriter.DOS_DATE, 14);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(body.length, 20);
      central.writeUInt32LE(data.length, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      central.writeUInt32LE(offset, 42);

      locals.push(local, name, body);
      centrals.push(central, name);
      offset += local.length + name.length + body.length;
      if (offset > 0xffffffff) {
        throw new AlephaError("The bundle is larger than a ZIP can hold.");
      }
    }

    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(sorted.length, 8);
    end.writeUInt16LE(sorted.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);

    return new Uint8Array(Buffer.concat([...locals, directory, end]));
  }

  /**
   * A relative, forward-slash path inside the archive, never escaping it.
   */
  protected check(path: string): string {
    if (
      path === "" ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.includes("\0") ||
      path
        .split("/")
        .some((part) => part === "" || part === "." || part === "..")
    ) {
      throw new AlephaError(`Refusing to archive the path '${path}'.`);
    }
    return path;
  }
}

/**
 * One file of a bundle archive.
 */
export interface OtaArchiveFile {
  /**
   * Relative to the bundle root, forward slashes, e.g. `assets/app.js`.
   */
  path: string;
  data: Uint8Array;
}
