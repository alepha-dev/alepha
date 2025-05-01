export class InvalidTokenError extends Error {
	public readonly statusCode = 401;
	public readonly code = "ERR_INVALID_TOKEN";
}
