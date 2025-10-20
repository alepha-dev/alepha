export class SecurityError extends Error {
  public name = "SecurityError";
  public readonly status = 403;
}
