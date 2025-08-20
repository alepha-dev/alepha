import type { RequestConfigSchema } from "../interfaces/ServerRequest.ts";

export const isMultipart = (options: {
	schema?: RequestConfigSchema;
	requestBodyType?: string;
}): boolean => {
	if (options.requestBodyType === "multipart/form-data") {
		return true;
	}

	if (options.schema?.body) {
		for (const key in options.schema.body.properties) {
			if (
				options.schema.body.properties[key].type === "string" &&
				options.schema.body.properties[key].format === "binary"
			) {
				return true;
			}
		}
	}

	return false;
};
