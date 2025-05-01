export class HttpError extends Error {
	constructor(
		readonly statusCode: number,
		readonly code: string,
		message: string,
		cause?: Error,
	) {
		super(message, { cause });
	}
}
