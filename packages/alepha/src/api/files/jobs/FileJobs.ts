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

      await Promise.all(
        files.map((file) => this.fileService.deleteFile(file.id)),
      );
    },
  });
}
