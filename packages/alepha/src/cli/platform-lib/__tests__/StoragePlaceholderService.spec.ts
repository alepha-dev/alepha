import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";
import { StoragePlaceholderService } from "../services/StoragePlaceholderService.ts";

const ROOT = "/app";
const STORAGE = `${ROOT}/node_modules/.alepha/buckets`;
const DB = "/app/node_modules/.alepha/sqlite.db";

const createContext = (outputs: Record<string, string>) => {
  const alepha = Alepha.create()
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ShellProvider, use: MemoryShellProvider });

  const shell = alepha.inject(MemoryShellProvider);
  const fs = alepha.inject(MemoryFileSystemProvider);
  const service = alepha.inject(StoragePlaceholderService);

  for (const [command, output] of Object.entries(outputs)) {
    shell.outputs.set(command, output);
  }

  return { alepha, shell, fs, service };
};

const tableQuery = `sqlite3 -json '${DB}' "SELECT name FROM sqlite_master WHERE type='table' AND name='files'"`;
const rowsQuery = `sqlite3 -json '${DB}' "SELECT bucket, blob_id FROM files"`;

describe("StoragePlaceholderService", () => {
  it("writes one placeholder per file row, under its bucket", async () => {
    const { fs, service } = createContext({
      [tableQuery]: '[{"name":"files"}]',
      [rowsQuery]: JSON.stringify([
        { bucket: "campaign-icons", blob_id: "a.png" },
        { bucket: "archive-blobs", blob_id: "b.jpg" },
      ]),
    });

    const result = await service.fill({ dbPath: DB, root: ROOT });

    expect(result.written).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.buckets).toEqual(["archive-blobs", "campaign-icons"]);
    expect(fs.wasWritten(`${STORAGE}/campaign-icons/a.png`)).toBe(true);
    expect(fs.wasWritten(`${STORAGE}/archive-blobs/b.jpg`)).toBe(true);
  });

  it("does nothing when the snapshot has no files table", async () => {
    // What sqlite3 -json really prints for a table that is not there. The
    // empty string this once stubbed is what a fake invents, not what the
    // parser must survive.
    const { fs, service } = createContext({ [tableQuery]: "[]" });

    const result = await service.fill({ dbPath: DB, root: ROOT });

    expect(result.written).toBe(0);
    expect([...fs.files.keys()].filter((it) => it.includes("buckets"))).toEqual(
      [],
    );
  });

  it("never overwrites a blob that already exists locally", async () => {
    const { fs, service } = createContext({
      [tableQuery]: '[{"name":"files"}]',
      [rowsQuery]: JSON.stringify([
        { bucket: "campaign-icons", blob_id: "kept.png" },
      ]),
    });

    await fs.writeFile(`${STORAGE}/campaign-icons/kept.png`, "REAL");

    const result = await service.fill({ dbPath: DB, root: ROOT });

    expect(result.written).toBe(0);
    expect(result.skipped).toBe(1);
    const kept = await fs.readFile(`${STORAGE}/campaign-icons/kept.png`);
    expect(Buffer.from(kept).toString()).toBe("REAL");
  });

  it("rejects a blob id that would escape the storage root", async () => {
    const { service } = createContext({
      [tableQuery]: '[{"name":"files"}]',
      [rowsQuery]: JSON.stringify([
        { bucket: "campaign-icons", blob_id: "../../escape.png" },
      ]),
    });

    await expect(service.fill({ dbPath: DB, root: ROOT })).rejects.toThrowError(
      /Unsafe storage path segment/,
    );
  });
});
