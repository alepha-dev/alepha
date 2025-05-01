export class SecurityError extends Error {
	public readonly statusCode = 403;
	public readonly code = "ERR_SECURITY";
}
