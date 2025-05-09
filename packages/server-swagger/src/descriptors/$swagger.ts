import { KIND, __descriptor } from "@alepha/core";
import type { OpenAPIV3 } from "openapi-types";

export interface SwaggerDescriptorOptions {
	info: OpenAPIV3.InfoObject;

	/**
	 * @default: "/docs"
	 */
	prefix?: string;

	/**
	 * If true, docs will be disabled.
	 */
	disabled?: boolean;

	ui?: boolean;
}

export interface SwaggerDescriptor {
	[KIND]: "SWAGGER";
	options: SwaggerDescriptorOptions;
	json(): OpenAPIV3.Document;
}

export const $swagger = (
	options: SwaggerDescriptorOptions,
): SwaggerDescriptor => {
	__descriptor("SWAGGER");
	return {
		[KIND]: "SWAGGER",
		options,
		json() {
			return {
				openapi: "3.0.0",
				info: options.info,
				paths: {},
			};
		},
	};
};

$swagger[KIND] = "SWAGGER";
