import { HttpError } from "./HttpError";

export class NotFoundError extends HttpError {
	constructor(message = "Resource not found") {
		super(404, "ERR_RESOURCE_NOTFOUND", message);
	}
}
