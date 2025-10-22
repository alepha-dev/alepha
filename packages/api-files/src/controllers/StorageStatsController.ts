import "@alepha/server-security";
import { $inject } from "@alepha/core";
import { $action } from "@alepha/server";
import { storageStatsSchema } from "../schemas/storageStatsSchema.ts";
import { FileService } from "../services/FileService.ts";

/**
 * REST API controller for storage analytics and statistics.
 * Provides endpoints for viewing storage usage metrics.
 */
export class StorageStatsController {
  protected readonly url = "/files/stats";
  protected readonly group = "files";
  protected readonly fileService = $inject(FileService);

  /**
   * GET /files/stats - Gets storage statistics.
   * Returns aggregated data including total size, file count,
   * and breakdowns by bucket and MIME type.
   */
  public readonly getStats = $action({
    path: this.url,
    group: this.group,
    description: "Get storage statistics",
    schema: {
      response: storageStatsSchema,
    },
    handler: () => this.fileService.getStorageStats(),
  });
}
