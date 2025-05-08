export class SecurityError extends Error {
	public readonly status = 403;
	public readonly code = "ERR_SECURITY";
}
