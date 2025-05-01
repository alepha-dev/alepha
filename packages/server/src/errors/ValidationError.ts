import { HttpError } from "./HttpError";

export class ValidationError extends HttpError {
	constructor(message = "Validation has failed") {
		super(400, "ERR_VALIDATION", message);
	}
}
