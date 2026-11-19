import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { FileStorageProvider } from "alepha/bucket";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { FileSystemProvider } from "alepha/system";

import { GitBackend, type GitRefTip } from "../backends/GitBackend.ts";
import {
  type CodeRepository,
  codeRepositories,
} from "../entities/codeRepositories.ts";

/**
 * Every Lore repository, backed up each night as a git bundle in the object
 * storage (#Q3946, folio #F1500 "Backup"): code is the most valuable thing a
 * project holds, Artifacts is a beta, and a new project may live only on
 * Lore. Not mirroring: it pushes nowhere.
 *
 * - **Where**: one storage container per repository, `code-backup-<id>`,
 *   files `<yyyyMMddHHmm>-<refs digest>.bundle`. On the Worker that is R2,
 *   where a stream of unknown length goes up by multipart upload
 *   (`R2FileStorageProvider`); on Docker the configured storage, which is the
 *   local disk unless set otherwise: the same disk as the repositories.
 * - **What**: `GitBackend.bundle`. On Artifacts a full fetch over smart HTTP
 *   (protocol v0, no side-band) streamed behind a bundle header; on disk
 *   `git bundle create --all`.
 * - **Skipped** when the refs are those of the newest bundle: nothing was
 *   pushed since.
 * - **Kept**: the last {@link CodeBackupJobs.KEEP}.
 * - **Restore**: `git clone <file>.bundle`, then `lore code import` into an
 *   empty repository.
 */
export class CodeBackupJobs {
  public static readonly KEEP = 7;

  protected readonly log = $logger();
  protected readonly backend = $inject(GitBackend);
  protected readonly storage = $inject(FileStorageProvider);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly repositories = $repository(codeRepositories);

  /**
   * In the `0 3 * * *` slot the other nightly sweeps share (`QualityJobs`
   * says why). One repository at a time: a bundle of this repository is
   * about 100 MB, and the next one waits for it.
   */
  public readonly backupRepositories = $job({
    name: "code.backup",
    description: "Backs up every git repository as a bundle in the storage.",
    cron: "0 3 * * *",
    timeout: [15, "minutes"],
    retry: { retries: 2 },
    handler: async () => {
      const rows = await this.repositories.findMany({ limit: 10000 });
      let written = 0;
      for (const row of rows) {
        try {
          if (await this.backup(row)) written += 1;
        } catch (error) {
          this.log.warn("A repository was not backed up", {
            repository: row.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      this.log.info(`Backed up ${written} of ${rows.length} repositories`);
    },
  });

  public container(repository: Pick<CodeRepository, "id">): string {
    return `code-backup-${repository.id}`;
  }

  /**
   * Bundle one repository unless nothing moved since its newest bundle.
   * Answers the file written, or undefined when skipped.
   */
  public async backup(repository: CodeRepository): Promise<string | undefined> {
    const refs = await this.backend.refs(repository.backendRef);
    if (refs.length === 0) return undefined;
    const container = this.container(repository);
    const digest = await this.digest(refs);
    const existing = (await this.storage.list(container))
      .filter((it) => it.endsWith(".bundle"))
      .toSorted()
      .toReversed();
    if (existing[0]?.endsWith(`-${digest}.bundle`)) return undefined;

    const startedAt = this.dt.nowMillis();
    const name = `${this.dt.now().format("YYYYMMDDHHmm")}-${digest}.bundle`;
    const stream = await this.backend.bundle(repository.backendRef, refs);
    await this.storage.upload(
      container,
      this.fs.createFile({
        stream,
        name,
        type: "application/x-git-bundle",
      }),
      name,
    );
    this.log.info("Backed up a repository", {
      repository: repository.id,
      file: name,
      refs: refs.length,
      ms: this.dt.nowMillis() - startedAt,
    });

    const stale = [name, ...existing].slice(CodeBackupJobs.KEEP);
    if (stale.length) await this.storage.deleteMany(container, stale);
    return name;
  }

  /**
   * Twelve hex characters of the refs' sha256: equal refs, equal digest.
   */
  protected async digest(refs: GitRefTip[]): Promise<string> {
    const text = refs
      .map((tip) => `${tip.sha} ${tip.name}`)
      .sort()
      .join("\n");
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text),
    );
    return [...new Uint8Array(hash)]
      .slice(0, 6)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
}
