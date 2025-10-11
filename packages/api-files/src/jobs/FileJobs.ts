import { $inject } from "@alepha/core";
import { $scheduler } from "@alepha/scheduler";
import { FileService } from "../services/FileService.ts";

export class FileJobs {
	protected readonly fileService = $inject(FileService);

	public readonly purgeFiles = $scheduler({
		description: "Purge files that are marked for deletion",
		interval: [1, "hour"],
		handler: async () => {
			const files = await this.fileService.findExpiredFiles();

			await Promise.all(
				files.map((file) => this.fileService.deleteFile(file.blobId)),
			);
		},
	});
}
