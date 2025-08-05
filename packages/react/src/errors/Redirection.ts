import type { HrefLike } from "../hooks/RouterHookApi.ts";

export class Redirection extends Error {
	public readonly page: HrefLike;

	constructor(page: HrefLike) {
		super("Redirection");
		this.page = page;
	}
}
