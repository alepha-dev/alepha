export class MissingContextError extends Error {
	constructor() {
		super("Missing context. Did you forget to call Alepha.create()?");
		this.name = "MissingContextError";
	}
}
