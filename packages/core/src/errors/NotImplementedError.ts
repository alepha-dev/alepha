export class NotImplementedError extends Error {
	constructor(provider: string) {
		super(
			`Method not available. ${provider} is abstract and must be implemented.`,
		);
	}
}
