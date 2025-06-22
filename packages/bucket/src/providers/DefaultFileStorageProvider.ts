import { NotImplementedError, type StreamLike } from "@alepha/core";
import type { FileStorageProvider } from "../interfaces/FileStorageProvider.ts";

export class DefaultFileStorageProvider implements FileStorageProvider {
	upload(): Promise<string> {
		throw new NotImplementedError(this.constructor.name);
	}

	exists(): Promise<boolean> {
		throw new NotImplementedError(this.constructor.name);
	}

	stream(): Promise<StreamLike> {
		throw new NotImplementedError(this.constructor.name);
	}

	delete(): Promise<void> {
		throw new NotImplementedError(this.constructor.name);
	}
}
