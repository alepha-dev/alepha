import { HttpError } from "./HttpError";

export class UnauthorizedError extends HttpError {
	constructor(message = "Not allowed to access this resource", cause?: Error) {
		super(401, "ERR_AUTHORIZATION", message, cause);
	}
}
