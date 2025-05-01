import type { Static, TSchema } from "@alepha/core";
import { t } from "@alepha/core";

declare module "@alepha/core" {
	interface TypeProvider extends MultipartTypeProvider {}
}

export class MultipartTypeProvider {
	file = () => t.unsafe<MultipartFile>("Any", { isFile: true });
	multipart = <T extends TSchema>() => t.unsafe<MultipartField<T>>("Any");
}

Object.assign(t, new MultipartTypeProvider());

/**
 * Create a schema for a multipart file.
 */
export interface MultipartFile {
	type: "file";
	toBuffer: () => Promise<Buffer>;
	toBlob?: () => Blob;
	fieldname: string;
	filename: string;
	encoding: string;
	mimetype: string;
}

/**
 * Create a schema for a multipart field.
 */
export interface MultipartField<T extends TSchema> {
	type: "field";
	value: Static<T>;
	mimetype: string;
	encoding: string;
}
