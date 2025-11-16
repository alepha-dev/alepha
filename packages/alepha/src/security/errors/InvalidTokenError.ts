export class InvalidTokenError extends Error {
  public readonly status = 401;
}
