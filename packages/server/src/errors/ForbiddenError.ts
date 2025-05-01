import { HttpError } from "./HttpError";

export class ForbiddenError extends HttpError {
	constructor(message = "No permission to access this resource") {
		super(403, "ERR_ACCESS_CONTROL", message);
	}
}
