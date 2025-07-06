import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { PassThrough, Readable } from "node:stream";
import { ReadableStream as NodeWebStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import type { FileLike, StreamLike } from "@alepha/core";
import { getContentType } from "./getContentType.ts";

export const file = (
	source: string | Buffer | ArrayBuffer | StreamLike,
	options: {
		type?: string;
		name?: string;
	} = {},
): FileLike => {
	// Handle URL strings
	if (
		typeof source === "string" &&
		(source.startsWith("file://") ||
			source.startsWith("http://") ||
			source.startsWith("https://"))
	) {
		return createFileFromUrl(source, options);
	}

	if (source instanceof ReadableStream || source instanceof NodeWebStream) {
		return createFileFromStream(Readable.from(source), options);
	}

	if (isReadableStream(source) || source instanceof Readable) {
		return createFileFromStream(source, options);
	}

	return createFileFromBuffer(
		Buffer.isBuffer(source)
			? source
			: typeof source === "string"
				? Buffer.from(source, "utf-8")
				: Buffer.from(source),
		options,
	);
};

export const createFileFromBuffer = (
	source: Buffer,
	options: {
		type?: string;
		name?: string;
	} = {},
): FileLike => {
	const name: string = options.name ?? "file";
	return {
		name,
		type: options.type ?? getContentType(options.name ?? name),
		size: source.byteLength,
		lastModified: Date.now(),
		stream: (): Readable => Readable.from(source),
		arrayBuffer: async (): Promise<ArrayBuffer> => {
			return bufferToArrayBuffer(source);
		},
		text: async (): Promise<string> => {
			return source.toString("utf-8");
		},
	};
};

export const createFileFromStream = (
	source: StreamLike,
	options: {
		type?: string;
		name?: string;
	} = {},
): FileLike & { _buffer: null | Buffer } => {
	let buffer: Buffer | null = null;

	return {
		name: options.name ?? "file",
		type: options.type ?? getContentType(options.name ?? "file"),
		size: 0,
		lastModified: Date.now(),
		stream: () => source,
		_buffer: null as Buffer | null,
		async arrayBuffer() {
			buffer ??= await streamToBuffer(source);
			return bufferToArrayBuffer(buffer);
		},
		async text() {
			buffer ??= await streamToBuffer(source);
			return buffer.toString("utf-8");
		},
	};
};

export const createFileFromUrl = (
	url: string,
	options: {
		type?: string;
		name?: string;
	} = {},
): FileLike => {
	const parsedUrl = new URL(url);
	const filename =
		options.name || parsedUrl.pathname.split("/").pop() || "file";
	let buffer: Buffer | null = null;

	return {
		name: filename,
		type: options.type ?? getContentType(filename),
		size: 0, // Unknown size until loaded
		lastModified: Date.now(),
		stream: () => createStreamFromUrl(url),
		async arrayBuffer() {
			buffer ??= await loadFromUrl(url);
			return bufferToArrayBuffer(buffer);
		},
		async text() {
			buffer ??= await loadFromUrl(url);
			return buffer.toString("utf-8");
		},
		filepath: url,
	};
};

const getStreamingResponse = (url: string): Readable => {
	const stream = new PassThrough();

	fetch(url)
		.then((res) => Readable.fromWeb(res.body as NodeWebStream).pipe(stream))
		.catch((err) => stream.destroy(err));

	return stream;
};

const loadFromUrl = async (url: string): Promise<Buffer> => {
	const parsedUrl = new URL(url);

	if (parsedUrl.protocol === "file:") {
		// Handle file:// URLs
		const filePath = fileURLToPath(url);
		return await readFile(filePath);
	} else if (
		parsedUrl.protocol === "http:" ||
		parsedUrl.protocol === "https:"
	) {
		// Handle HTTP/HTTPS URLs
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch ${url}: ${response.status} ${response.statusText}`,
			);
		}
		const arrayBuffer = await response.arrayBuffer();
		return Buffer.from(arrayBuffer);
	} else {
		throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
	}
};

const createStreamFromUrl = (url: string): Readable => {
	const parsedUrl = new URL(url);

	if (parsedUrl.protocol === "file:") {
		// For file:// URLs, create a stream that reads the file
		return createReadStream(fileURLToPath(url));
	} else if (
		parsedUrl.protocol === "http:" ||
		parsedUrl.protocol === "https:"
	) {
		// For HTTP/HTTPS URLs, create a stream that fetches the content
		return getStreamingResponse(url);
	} else {
		throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
	}
};

/**
 * Converts a stream-like object to a Buffer.
 */
export const streamToBuffer = async (
	streamLike: StreamLike,
): Promise<Buffer> => {
	const stream =
		streamLike instanceof Readable
			? streamLike
			: Readable.fromWeb(streamLike as NodeWebStream);

	return new Promise<Buffer>((resolve, reject) => {
		const buffer: any[] = [];
		stream.on("data", (chunk) => buffer.push(Buffer.from(chunk)));
		stream.on("end", () => resolve(Buffer.concat(buffer)));
		stream.on("error", (err) =>
			reject(new Error("Error converting stream", { cause: err })),
		);
	});
};

/**
 * Converts a Node.js Buffer to an ArrayBuffer.
 */
export const bufferToArrayBuffer = (buffer: Buffer): ArrayBuffer => {
	return buffer.buffer.slice(
		buffer.byteOffset,
		buffer.byteOffset + buffer.byteLength,
	) as ArrayBuffer;
};

export const isReadableStream = (obj: unknown): obj is NodeJS.ReadableStream =>
	obj instanceof Readable ||
	(obj != null &&
		typeof obj === "object" &&
		typeof (obj as NodeJS.ReadableStream).pipe === "function" &&
		typeof (obj as NodeJS.ReadableStream).read === "function");
