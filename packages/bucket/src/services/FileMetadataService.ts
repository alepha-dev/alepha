import type { FileLike } from "@alepha/core";

export interface FileMetadata {
	name: string;
	type: string;
}

/**
 * Service for encoding/decoding file metadata in storage streams.
 *
 * The metadata is stored at the beginning of the file with the following structure:
 * - 4-byte header: UInt32BE containing the metadata length
 * - N-byte metadata: JSON object containing file metadata (name, type)
 * - Remaining bytes: Actual file content
 *
 * @example
 * ```typescript
 * const service = new FileMetadataService();
 *
 * // Encode metadata and content for storage
 * const { header, metadata } = service.encodeMetadata({
 *   name: "document.pdf",
 *   type: "application/pdf"
 * });
 *
 * // Decode metadata from stored file
 * const fileHandle = await open(filePath, 'r');
 * const { metadata, contentStart } = await service.decodeMetadata(fileHandle);
 * ```
 */
export class FileMetadataService {
	/**
	 * Length of the header containing metadata size (4 bytes for UInt32BE)
	 */
	public static readonly METADATA_HEADER_LENGTH = 4;

	/**
	 * Encodes file metadata into header and metadata buffers.
	 *
	 * @param file - The file or metadata to encode
	 * @returns Object containing the header buffer and metadata buffer
	 */
	public encodeMetadata(file: FileLike | FileMetadata): {
		header: Buffer;
		metadata: Buffer;
	} {
		const metadata = Buffer.from(
			JSON.stringify({
				name: file.name,
				type: file.type,
			}),
			"utf8",
		);

		const header = Buffer.alloc(FileMetadataService.METADATA_HEADER_LENGTH);
		header.writeUInt32BE(metadata.byteLength, 0);

		return { header, metadata };
	}

	/**
	 * Decodes file metadata from a file handle.
	 *
	 * @param fileHandle - File handle opened for reading
	 * @returns Object containing the decoded metadata and content start position
	 */
	public async decodeMetadata(fileHandle: {
		read: (
			buffer: Buffer,
			offset: number,
			length: number,
			position: number,
		) => Promise<{ bytesRead: number }>;
	}): Promise<{ metadata: FileMetadata; contentStart: number }> {
		const headerLength = FileMetadataService.METADATA_HEADER_LENGTH;

		// Read the header to get metadata length
		const headerBuffer = Buffer.alloc(headerLength);
		await fileHandle.read(headerBuffer, 0, headerLength, 0);
		const metadataLength = headerBuffer.readUInt32BE(0);
		const contentStart = headerLength + metadataLength;

		// Read the metadata block
		const metadataBuffer = Buffer.alloc(metadataLength);
		await fileHandle.read(metadataBuffer, 0, metadataLength, headerLength);
		const metadata = JSON.parse(
			metadataBuffer.toString("utf8"),
		) as FileMetadata;

		return { metadata, contentStart };
	}

	/**
	 * Decodes file metadata from a buffer.
	 *
	 * @param buffer - Buffer containing the file with metadata
	 * @returns Object containing the decoded metadata and content start position
	 */
	public decodeMetadataFromBuffer(buffer: Buffer): {
		metadata: FileMetadata;
		contentStart: number;
	} {
		const headerLength = FileMetadataService.METADATA_HEADER_LENGTH;

		// Read the header to get metadata length
		const metadataLength = buffer.readUInt32BE(0);
		const contentStart = headerLength + metadataLength;

		// Read the metadata block
		const metadataBuffer = buffer.subarray(headerLength, contentStart);
		const metadata = JSON.parse(
			metadataBuffer.toString("utf8"),
		) as FileMetadata;

		return { metadata, contentStart };
	}

	/**
	 * Creates a complete buffer with metadata header, metadata, and content.
	 *
	 * @param file - The file to encode
	 * @param content - The file content as a buffer
	 * @returns Complete buffer ready for storage
	 */
	public createFileBuffer(
		file: FileLike | FileMetadata,
		content: Buffer,
	): Buffer {
		const { header, metadata } = this.encodeMetadata(file);
		return Buffer.concat([header, metadata, content]);
	}
}
