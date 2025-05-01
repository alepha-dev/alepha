import type { MultipartFile } from "../providers/MultipartTypeProvider";

/**
 * Create a multipart file object from a buffer.
 *
 * @param buffer - The buffer to create the file from.
 * @param options - Additional options.
 */
export const createMultipartFile = (
	buffer: string | Buffer | Blob | File,
	options?: Partial<MultipartFile>,
): MultipartFile => {
	if (buffer instanceof File) {
		return {
			type: "file",
			toBuffer: () => {
				return new Promise<Buffer>((resolve) => {
					const reader = new FileReader();
					reader.onload = () => {
						resolve(Buffer.from(reader.result as ArrayBuffer));
					};
					reader.readAsArrayBuffer(buffer);
				});
			},
			toBlob: () => buffer,
			filename: buffer.name,
			mimetype: buffer.type || "application/octet-stream",
			encoding: "binary",
			fieldname: "file",
			...options,
		} as const;
	}

	if (buffer instanceof Blob) {
		return {
			type: "file",
			toBuffer: () => {
				return new Promise<Buffer>((resolve) => {
					const reader = new FileReader();
					reader.onload = () => {
						resolve(Buffer.from(reader.result as ArrayBuffer));
					};
					reader.readAsArrayBuffer(buffer);
				});
			},
			toBlob: () => buffer,
			filename: "file.bin",
			mimetype: buffer.type || "application/octet-stream",
			encoding: "utf-8",
			fieldname: "file",
			...options,
		} as const;
	}

	if (typeof buffer === "string") {
		return {
			type: "file",
			toBuffer: () => Promise.resolve(Buffer.from(buffer)),
			toBlob: () => new Blob([buffer]),
			filename: "file.txt",
			mimetype: "text/plain",
			encoding: "utf-8",
			fieldname: "file",
			...options,
		} as const;
	}

	return {
		type: "file",
		toBuffer: () => Promise.resolve(buffer),
		toBlob: () => new Blob([buffer]),
		filename: "file.bin",
		mimetype: "application/octet-stream",
		encoding: "binary",
		fieldname: "file",
		...options,
	} as const;
};
