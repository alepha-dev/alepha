import type { IncomingHttpHeaders } from "node:http";

export type Headers = IncomingHttpHeaders & Record<string, string>;

export class HeaderManager {
	public readonly req: Headers;
	public readonly res: Headers;

	constructor(req: Headers = {}) {
		this.req = {};
		this.res = {};

		for (const key in req) {
			this.req[key.toLowerCase()] = req[key];
		}
	}

	public get(key: keyof Headers): string | undefined {
		return this.req[String(key).toLowerCase()];
	}

	public set(key: keyof Headers, value: string | string[]): void {
		this.res[key] = value as string;
	}

	public rep(key: keyof Headers, value: string | string[]): void {
		this.req[key] = value as string;
	}

	public toResponse(): Headers {
		return this.res;
	}
}
