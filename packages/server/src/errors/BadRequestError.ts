import { HttpError } from "./HttpError";

export class BadRequestError extends HttpError {
	constructor(message = "Invalid request body") {
		super(400, "ERR_INVALID_REQUEST", message);
	}
}
