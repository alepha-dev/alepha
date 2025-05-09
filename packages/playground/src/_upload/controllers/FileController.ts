import { type FileLike, t } from "@alepha/core";
import { $action } from "@alepha/server";
import { file } from "@alepha/server";

export class FileCtrl {
	file?: FileLike;

	push = $action({
		security: false,
		schema: {
			body: t.object({
				file: t.file({
					max: 10 * 1024 * 1024, // 10MB
				}),
				metadata: t.string(),
			}),
		},
		handler: async ({ body }) => {
			const buffer = await body.file.arrayBuffer();
			this.file = await file(buffer, body.file);
		},
	});

	image = $action({
		schema: {
			response: t.file(),
		},
		handler: () => {
			if (!this.file) {
				throw new Error("No file uploaded");
			}

			return this.file;
		},
	});

	download = $action({
		security: false,
		schema: {
			response: t.file(),
		},
		handler: () => {
			if (!this.file) {
				throw new Error("No file uploaded");
			}

			return this.file;
		},
	});
}
