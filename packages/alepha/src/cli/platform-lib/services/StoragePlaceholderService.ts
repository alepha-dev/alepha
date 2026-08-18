import { join } from "node:path";
import { $inject, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import { PlaceholderAssets } from "./PlaceholderAssets.ts";

export interface FillPlaceholdersOptions {
  /**
   * The local SQLite snapshot to read file rows from.
   */
  dbPath: string;
  /**
   * Project root. The storage directory is resolved beneath it.
   */
  root: string;
  /**
   * Storage directory, relative to the root. Defaults to the path
   * LocalFileStorageProvider reads.
   */
  storagePath?: string;
}

export interface FillPlaceholdersResult {
  written: number;
  skipped: number;
  buckets: string[];
}

/**
 * Writes stand-in blobs for every file row in a freshly exported database.
 *
 * A database export copies rows, not objects: the file table arrives intact
 * while the blobs it names stay in remote storage. The local dev server then
 * answers 404 for every image it is asked to serve, once per row, which on a
 * real project means hundreds of them.
 *
 * This fills the gap at export time rather than at request time. Serving a
 * stand-in when a blob is missing would need a development-only guard, and a
 * guard that fails open turns "this file is gone" into "here is a grey square"
 * in production, hiding real data loss. Files written to disk cannot fail that
 * way, and they can be inspected with "ls".
 *
 * Placeholders never overwrite an existing file, so blobs uploaded locally
 * survive a re-export.
 */
export class StoragePlaceholderService {
  protected static readonly DEFAULT_STORAGE_PATH =
    "node_modules/.alepha/buckets";

  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);
  protected readonly assets = $inject(PlaceholderAssets);

  /**
   * Writes one placeholder per file row. A snapshot with no file table is not
   * an error: the export command also serves apps that have no files module.
   */
  public async fill(
    options: FillPlaceholdersOptions,
  ): Promise<FillPlaceholdersResult> {
    const result: FillPlaceholdersResult = {
      written: 0,
      skipped: 0,
      buckets: [],
    };

    if (!(await this.hasFilesTable(options.dbPath))) {
      this.log.debug("No files table in the snapshot, skipping placeholders.");
      return result;
    }

    const rows = await this.readFileRows(options.dbPath);
    if (!rows.length) {
      return result;
    }

    const storageRoot = join(
      options.root,
      options.storagePath ?? StoragePlaceholderService.DEFAULT_STORAGE_PATH,
    );
    const buckets = new Set<string>();

    for (const row of rows) {
      if (!row.bucket || !row.blob_id) continue;
      this.assertSafeSegment(row.bucket);
      this.assertSafeSegment(row.blob_id);

      const dir = join(storageRoot, row.bucket);
      const target = join(dir, row.blob_id);
      buckets.add(row.bucket);

      if (await this.fs.exists(target)) {
        result.skipped++;
        continue;
      }

      await this.fs.mkdir(dir, { recursive: true });
      await this.fs.writeFile(target, this.assets.bytesFor(row.blob_id));
      result.written++;
    }

    result.buckets = [...buckets].sort();

    this.log.info(
      `Wrote ${result.written} placeholder blobs across ${result.buckets.length} bucket(s), skipped ${result.skipped} already present.`,
    );

    return result;
  }

  /**
   * Rejects a path segment that could escape the storage root.
   *
   * Mirrors the guard in LocalFileStorageProvider.path(). The values come from
   * a database the operator just exported, so this is a consistency check
   * rather than a trust boundary, but it is what keeps a malformed row from
   * writing outside the storage directory.
   */
  protected assertSafeSegment(value: string): void {
    if (/[/\\]/.test(value) || value.includes("..")) {
      throw new AlephaError(`Unsafe storage path segment: ${value}`);
    }
  }

  protected async hasFilesTable(dbPath: string): Promise<boolean> {
    const out = await this.query(
      dbPath,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='files'",
    );

    return out.length > 0;
  }

  protected async readFileRows(
    dbPath: string,
  ): Promise<Array<{ bucket?: string; blob_id?: string }>> {
    return await this.query(dbPath, "SELECT bucket, blob_id FROM files");
  }

  /**
   * Runs a query through the sqlite3 CLI in JSON mode.
   *
   * Uses the shell provider directly rather than the task runner: the runner
   * streams instead of capturing once debug logging is on, so its return value
   * is empty exactly when someone passes --verbose to diagnose a problem.
   */
  protected async query(dbPath: string, sql: string): Promise<any[]> {
    const out = await this.shell.run(`sqlite3 -json '${dbPath}' "${sql}"`, {
      capture: true,
    });

    const trimmed = out?.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch (cause) {
      throw new AlephaError("Could not read file rows from the snapshot.", {
        cause,
      });
    }
  }
}
