import { $inject, type FileLike } from "alepha";
import { FileStorageProvider } from "alepha/bucket";
import { $logger } from "alepha/logger";

import {
  type ArtifactSchema,
  artifactSchemaSchema,
} from "../schemas/artifactSchemaSchema.ts";
import { SchemaCompatibility } from "./SchemaCompatibility.ts";

/**
 * The database schema a pushed build expects, stored beside its archive
 * (#Q3542), so a rollback can say whether that build still fits the live
 * schema instead of only counting the migrations in between.
 *
 * ## What travels, and what is kept
 *
 * The push carries `schema.json`: `{ version: 1, dialects: { <dialect>:
 * <snapshot> } }`, each value the NEWEST Drizzle `snapshot.json` under the
 * build's `migrations/<dialect>/`, as drizzle-kit wrote it. The raw snapshot
 * travels so the CLI needs no knowledge of its format; what is kept is the
 * reduction {@link SchemaCompatibility.reduce} makes, a fraction of its size.
 *
 * ## ⚠️ The pusher's claim, and never a reason to refuse a push
 *
 * Like the asset list (#Q3381) it is stored per project, keyed by the
 * archive's digest, so it never speaks for another project's deploy of the
 * same bytes. Unlike the asset list, nothing deploys from it: it only shapes
 * a rollback warning. So a part this Lore cannot read is dropped with a log
 * line rather than answered with a 400. A drizzle-kit that changes its format
 * must not turn every pipeline red; the rollback then falls back to counting.
 */
export class ArtifactSchemaStore {
  protected readonly log = $logger();
  protected readonly storage = $inject(FileStorageProvider);
  protected readonly compatibility = $inject(SchemaCompatibility);

  /**
   * The largest `schema.json` read: a snapshot runs ~350 bytes a column, so
   * this is some 10,000 columns.
   */
  public static readonly MAX_PUSHED_BYTES = 4 * 1024 * 1024;

  public key(projectId: number, sha256: string): string {
    return `artifact-schema-v1-p${projectId}-${sha256}.json`;
  }

  /**
   * Reduce and store what a push carried. Never throws.
   */
  public async storePushed(
    bucket: string,
    projectId: number,
    sha256: string,
    file: FileLike,
  ): Promise<void> {
    try {
      const reduced = await this.reducePushed(sha256, file);
      if (!reduced) {
        return;
      }
      const key = this.key(projectId, sha256);
      await this.storage.upload(
        bucket,
        new File([JSON.stringify(reduced)], key, { type: "application/json" }),
        key,
      );
    } catch (error) {
      this.log.warn("The schema sent with this push was not stored", {
        sha256,
        error,
      });
    }
  }

  /**
   * The schema stored for an archive in this project, or `undefined` when the
   * push sent none (an older CLI, a build with no migrations).
   */
  public async read(
    bucket: string,
    projectId: number,
    sha256: string,
  ): Promise<ArtifactSchema | undefined> {
    try {
      const file = await this.storage.download(
        bucket,
        this.key(projectId, sha256),
      );
      const parsed = artifactSchemaSchema.safeParse(
        JSON.parse(await file.text()),
      );
      if (parsed.success && parsed.data.sha256 === sha256) {
        return parsed.data;
      }
    } catch {
      // Absent is the normal case for every artifact pushed before #Q3542.
    }
    return undefined;
  }

  public async remove(
    bucket: string,
    projectId: number,
    sha256: string,
  ): Promise<void> {
    try {
      await this.storage.delete(bucket, this.key(projectId, sha256));
    } catch {
      // Already absent.
    }
  }

  protected async reducePushed(
    sha256: string,
    file: FileLike,
  ): Promise<ArtifactSchema | undefined> {
    if (file.size > ArtifactSchemaStore.MAX_PUSHED_BYTES) {
      this.log.warn("The schema sent with this push is too large to read", {
        size: file.size,
      });
      return undefined;
    }
    const pushed = JSON.parse(await file.text()) as {
      version?: unknown;
      dialects?: Record<string, unknown>;
    };
    if (pushed?.version !== 1 || typeof pushed.dialects !== "object") {
      this.log.warn("The schema sent with this push is not one Lore reads");
      return undefined;
    }
    const dialects: ArtifactSchema["dialects"] = {};
    for (const [dialect, snapshot] of Object.entries(pushed.dialects ?? {})) {
      const reduced = this.compatibility.reduce(snapshot);
      if (reduced) {
        dialects[dialect] = reduced;
      }
    }
    if (Object.keys(dialects).length === 0) {
      return undefined;
    }
    return { version: 1, sha256, dialects };
  }
}
