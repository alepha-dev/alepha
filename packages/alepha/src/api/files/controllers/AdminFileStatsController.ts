import { $inject } from "alepha";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { storageStatsSchema } from "../schemas/storageStatsSchema.ts";
import { FileService } from "../services/FileService.ts";

/**
 * REST API controller for storage analytics and statistics.
 * Provides endpoints for viewing storage usage metrics.
 */
export class AdminFileStatsController {
  protected readonly url = "/files/stats";
  protected readonly group = "admin:files";
  protected readonly fileService = $inject(FileService);

  /**
   * GET /files/stats - Gets storage statistics.
   * Returns aggregated data including total size, file count,
   * and breakdowns by bucket and MIME type.
   */
  public readonly getFileStats = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:file:read"] })],
    description: "Get storage statistics",
    schema: {
      response: storageStatsSchema,
    },
    handler: () => this.fileService.getStorageStats(),
  });
}
