export class MissingContextError extends Error {
	readonly name = "MissingContextError";

	constructor() {
		super("Missing context. Did you forget to call Alepha.create()?");
		this.name = "MissingContextError";
	}
}
