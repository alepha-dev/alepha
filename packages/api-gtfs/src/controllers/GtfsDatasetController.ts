import { $inject, t } from "@alepha/core";
import { $action } from "@alepha/server";
import { gtfsImportResultSchema } from "../schemas/gtfsImportResultSchema.ts";
import { GtfsDatabaseService } from "../services/GtfsDatabaseService.ts";
import { GtfsImportService } from "../services/GtfsImportService.ts";

/**
 * Controller for GTFS dataset import and management
 */
export class GtfsDatasetController {
	private readonly dbService = $inject(GtfsDatabaseService);
	private readonly importService = $inject(GtfsImportService);

	private readonly url = "/gtfs";
	private readonly group = "gtfs";

	public importGtfsFile = $action({
		path: `${this.url}/import-file`,
		method: "POST",
		group: this.group,
		schema: {
			body: t.object({
				dataset: t.optional(
					t.string({ description: "Unique name for this GTFS dataset" }),
				),
				inMemory: t.optional(
					t.boolean({
						description:
							"Store dataset in memory only (not persisted to disk). Defaults to true in test environment.",
					}),
				),
				file: t.file(),
			}),
			response: gtfsImportResultSchema,
		},
		handler: async ({ body }) => {
			const [name] = body.file.name.split(".");
			console.log(body.file);
			console.log(name);
			console.log(body.dataset ?? name);
			return await this.importService.import(
				body.dataset || name,
				Buffer.from(await body.file.arrayBuffer()),
				body.inMemory,
			);
		},
	});

	public importGtfsUrl = $action({
		path: `${this.url}/import-url`,
		method: "POST",
		group: this.group,
		schema: {
			body: t.object({
				dataset: t.string({ description: "Unique name for this GTFS dataset" }),
				url: t.string({
					description: "URL to GTFS ZIP file or base64-encoded ZIP data",
				}),
				inMemory: t.optional(
					t.boolean({
						description:
							"Store dataset in memory only (not persisted to disk). Defaults to true in test environment.",
					}),
				),
			}),
			response: gtfsImportResultSchema,
		},
		handler: async ({ body }) => {
			return await this.importService.import(
				body.dataset,
				await this.importService.fetch(body.url),
				body.inMemory,
			);
		},
	});

	/**
	 * List all available GTFS datasets
	 */
	public listDatasets = $action({
		path: `${this.url}/datasets`,
		method: "GET",
		group: this.group,
		schema: {
			response: t.object({
				datasets: t.array(
					t.object({
						name: t.string(),
						url: t.string(),
					}),
				),
			}),
		},
		handler: async () => {
			return {
				datasets: await this.dbService.listDatasets(),
			};
		},
	});

	/**
	 * Delete a GTFS dataset
	 */
	public deleteDataset = $action({
		path: `${this.url}/datasets/:dataset`,
		method: "DELETE",
		group: this.group,
		schema: {
			params: t.object({
				dataset: t.string(),
			}),
			response: t.object({
				success: t.boolean(),
			}),
		},
		handler: async ({ params }) => {
			await this.dbService.deleteDataset(params.dataset);
			return { success: true };
		},
	});
}
