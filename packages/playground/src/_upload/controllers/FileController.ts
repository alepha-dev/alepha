import { writeFile } from "node:fs/promises";
import { t } from "@alepha/core";
import { $action } from "@alepha/server";

export class FileCtrl {
	file?: {
		buffer: ArrayBuffer;
		name: string;
		type: string;
	};

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
			console.time("buffer");
			this.file = {
				buffer: await body.file.arrayBuffer(),
				name: body.file.name,
				type: body.file.type,
			};
			await writeFile(
				`./file-buffer-${this.file.name}`,
				Buffer.from(this.file.buffer),
			);
			console.timeEnd("buffer");
		},
	});

	download = $action({
		schema: {
			params: t.object({
				name: t.string(),
			}),
			response: t.file(),
		},
		handler: () => {
			if (!this.file) {
				throw new Error("No file uploaded");
			}

			return new File([this.file.buffer], this.file.name, {
				type: this.file.type,
			});
		},
	});
}
