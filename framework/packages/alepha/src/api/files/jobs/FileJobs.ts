import { $inject, AlephaError } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";

import { FileService } from "../services/FileService.ts";

export class FileJobs {
  protected readonly fileService = $inject(FileService);
  protected readonly log = $logger();

  public readonly purgeFiles = $job({
    name: "system.files.purge-deleted",
    description:
      "Deletes stored files past their expiration date, ten at a time.",
    cron: "0 * * * *", // Hourly at minute 0
    timeout: [30, "seconds"],
    handler: async () => {
      const files = await this.fileService.findExpiredFiles();

      // Bounded. `Promise.all` over every expired file fired up to 1000
      // concurrent deletes at the storage backend and the database at once;
      // a large backlog took both down rather than draining steadily.
      const CONCURRENCY = 10;
      let failed = 0;
      for (let i = 0; i < files.length; i += CONCURRENCY) {
        await Promise.all(
          files.slice(i, i + CONCURRENCY).map((file) =>
            // One row that cannot be deleted (its `$storage` is gone from
            // the code, say) must not keep the rest of the backlog.
            this.fileService.deleteFile(file.id).catch((error: unknown) => {
              failed++;
              this.log.warn(
                `Failed to purge expired file ${file.id} from storage ${file.bucket}`,
                error,
              );
            }),
          ),
        );
      }
      // Every row was tried; the run still ends in error, so an outage of
      // the storage or the database is not a green run.
      if (failed > 0) {
        throw new AlephaError(
          `Failed to purge ${failed} of ${files.length} expired files`,
        );
      }
    },
  });
}
