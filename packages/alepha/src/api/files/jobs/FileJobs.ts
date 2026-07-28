import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { FileService } from "../services/FileService.ts";

export class FileJobs {
  protected readonly fileService = $inject(FileService);

  public readonly purgeFiles = $job({
    name: "api:files:purgeFiles",
    description: "Purge files that are marked for deletion",
    cron: "0 * * * *", // Hourly at minute 0
    handler: async () => {
      const files = await this.fileService.findExpiredFiles();

      // Bounded. `Promise.all` over every expired file fired up to 1000
      // concurrent deletes at the storage backend and the database at once;
      // a large backlog took both down rather than draining steadily.
      const CONCURRENCY = 10;
      for (let i = 0; i < files.length; i += CONCURRENCY) {
        await Promise.all(
          files
            .slice(i, i + CONCURRENCY)
            .map((file) => this.fileService.deleteFile(file.id)),
        );
      }
    },
  });
}
