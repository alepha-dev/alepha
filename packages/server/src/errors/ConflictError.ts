import { HttpError } from "./HttpError";

export class ConflictError extends HttpError {
	constructor(message = "Entity already exists") {
		super(409, "ERR_CONFLICT", message);
	}
}
