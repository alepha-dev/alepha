import { $inject } from "@alepha/core";
import { $scheduler } from "@alepha/scheduler";
import { FileService } from "../services/FileService.ts";

export class FileJobs {
  protected readonly fileService = $inject(FileService);

  public readonly purgeFiles = $scheduler({
    description: "Purge files that are marked for deletion",
    cron: "*/15 * * * *", // Every 15 minutes
    handler: async () => {
      const files = await this.fileService.findExpiredFiles();

      await Promise.all(
        files.map((file) => this.fileService.deleteFile(file.id)),
      );
    },
  });
}
