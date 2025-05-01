export class AppNotStartedError extends Error {
	constructor() {
		super("App not started. Please start the app before.");
	}
}
