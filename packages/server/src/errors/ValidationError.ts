import { HttpError } from "./HttpError.ts";

export class ValidationError extends HttpError {
	constructor(message = "Validation has failed", cause?: unknown) {
		super({
			message,
			status: 400,
			cause,
		});
	}
}
