import { AlephaBucket, FileStorageProvider } from "@alepha/bucket";
import { $module } from "@alepha/core";
import { VercelFileStorageProvider } from "./providers/VercelFileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/VercelFileStorageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha Bucket that provides Vercel Blob Storage capabilities.
 *
 * @see {@link VercelFileStorageProvider}
 * @module alepha.bucket.vercel
 */
export const AlephaBucketVercel = $module({
	name: "alepha.bucket.vercel",
	services: [VercelFileStorageProvider],
	register: (alepha) =>
		alepha
			.with({
				optional: true,
				provide: FileStorageProvider,
				use: VercelFileStorageProvider,
			})
			.with(AlephaBucket),
});
