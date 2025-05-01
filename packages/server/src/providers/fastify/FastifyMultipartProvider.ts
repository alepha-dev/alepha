import { $hook } from "@alepha/core";
import type {
	FastifyMultipartAttachFieldsToBodyOptions,
	FastifyMultipartBaseOptions,
	FastifyMultipartOptions,
} from "@fastify/multipart";
import multipart from "@fastify/multipart";

export type FastifyMultipartProviderOptions =
	| FastifyMultipartBaseOptions
	| FastifyMultipartOptions
	| FastifyMultipartAttachFieldsToBodyOptions;

export class FastifyMultipartProvider {
	protected readonly configure = $hook({
		name: "configure:fastify",
		handler: async (app) => {
			await app.register(multipart, this.options());
		},
	});

	public options(
		override: FastifyMultipartProviderOptions = {},
	): FastifyMultipartProviderOptions {
		return {
			attachFieldsToBody: true,
			limits: {
				fieldNameSize: 100, // Max field name size in bytes
				fieldSize: 100, // Max field value size in bytes
				fields: 10, // Max number of non-file fields
				fileSize: 5000000, // For multipart forms, the max file size in bytes
				files: 1, // Max number of file fields
				headerPairs: 2000, // Max number of header key=>value pairs
				parts: 1000, // For multipart forms, the max number of parts (fields + files)
			},
			...override,
		};
	}
}
