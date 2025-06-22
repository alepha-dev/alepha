import { NotImplementedError } from "@alepha/core";
import type { CacheProvider } from "../interfaces/CacheProvider.ts";

export class DefaultCacheProvider implements CacheProvider {
	constructor() {
		throw new NotImplementedError(this.constructor.name);
	}

	public async get(): Promise<string | undefined> {
		throw new NotImplementedError(this.constructor.name);
	}

	public async set(): Promise<string> {
		throw new NotImplementedError(this.constructor.name);
	}

	public async del(): Promise<void> {
		throw new NotImplementedError(this.constructor.name);
	}
}
