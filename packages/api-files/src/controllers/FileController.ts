import "@alepha/server-security";
import { $inject, t } from "@alepha/core";
import { pg } from "@alepha/postgres";
import { $action, okSchema } from "@alepha/server";
import { fileQuerySchema } from "../schemas/fileQuerySchema.ts";
import { fileResourceSchema } from "../schemas/fileResourceSchema.ts";
import { FileService } from "../services/FileService.ts";

export class FileController {
	protected readonly url = "/files";
	protected readonly group = "files";
	protected readonly fileService = $inject(FileService);

	public readonly findFiles = $action({
		path: this.url,
		group: this.group,
		schema: {
			query: fileQuerySchema,
			response: pg.page(fileResourceSchema),
		},
		handler: ({ query }) => this.fileService.findFiles(query),
	});

	public readonly deleteFile = $action({
		method: "DELETE",
		path: `${this.url}/:id`,
		group: this.group,
		schema: {
			params: t.object({
				id: t.uuid(),
			}),
			response: okSchema,
		},
		handler: ({ params }) => this.fileService.deleteFile(params.id),
	});

	public readonly uploadFile = $action({
		path: this.url,
		group: this.group,
		schema: {
			body: t.object({
				file: t.file(),
			}),
			query: t.object({
				expirationDate: t.optional(t.datetime()),
				container: t.optional(t.string()),
			}),
			response: fileResourceSchema,
		},
		handler: async ({ body, user, query }) =>
			this.fileService.uploadFile(body.file, { user, ...query }),
	});

	public readonly streamFile = $action({
		path: `${this.url}/:id`,
		group: this.group,
		schema: {
			params: t.object({
				id: t.uuid(),
			}),
			response: t.file(),
		},
		handler: ({ params }) => this.fileService.streamFile(params.id),
	});
}
