export class NotImplementedError extends Error {
	constructor(provider: string) {
		super(`${provider} is abstract and must be implemented.`);
	}
}
