export class AppNotStartedError extends Error {
	readonly name = "AppNotStartedError";

	constructor() {
		super("App not started. Please start the app before.");
	}
}
