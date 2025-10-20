export class EmailError extends Error {
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "EmailError";
    this.cause = cause;
  }
}
