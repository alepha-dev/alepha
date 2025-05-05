import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";

declare global {
	const Bun: {
		file: any;
	};
}

const isBun = typeof Bun !== "undefined";

export interface SaveFileOptions {
	maxSize?: number; // in bytes
	allowedMimeTypes?: string[]; // e.g., ['image/png', 'application/pdf']
}

export interface SavedFileMetadata {
	filename: string;
	size: number;
	mime: string;
	sha256: string;
}

export async function saveFileToDisk(
	file: File,
	path: string,
	options?: SaveFileOptions,
): Promise<SavedFileMetadata> {
	await mkdir(dirname(path), { recursive: true });

	const stream = file.stream();
	const hash = createHash("sha256");
	let size = 0;

	// Validate MIME type before streaming
	if (
		options?.allowedMimeTypes &&
		!options.allowedMimeTypes.includes(file.type)
	) {
		throw new Error(`MIME type "${file.type}" not allowed`);
	}

	if (isBun) {
		const writer = Bun.file(path).writer();
		const reader = stream.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (options?.maxSize && size > options.maxSize) {
				await writer.end(); // Stop writing
				throw new Error(`File too large (max ${options.maxSize} bytes)`);
			}
			hash.update(value);
			await writer.write(value);
		}
		await writer.end();
	} else {
		const nodeStream = Readable.fromWeb(stream as any);
		const fs = await import("node:fs");
		const writable = fs.createWriteStream(path);

		await new Promise<void>((resolve, reject) => {
			nodeStream.on("data", (chunk) => {
				size += chunk.length;
				if (options?.maxSize && size > options.maxSize) {
					writable.destroy();
					reject(new Error(`File too large (max ${options.maxSize} bytes)`));
					return;
				}
				hash.update(chunk);
			});
			nodeStream.pipe(writable).on("finish", resolve).on("error", reject);
		});
	}

	return {
		filename: file.name,
		size,
		mime: file.type,
		sha256: hash.digest("hex"),
	};
}
