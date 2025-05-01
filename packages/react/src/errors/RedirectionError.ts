import type { HrefLike } from "../hooks/RouterHookApi";

export class RedirectionError extends Error {
	constructor(public readonly page: HrefLike) {
		super("Redirection");
	}
}
