export class SmsError extends Error {
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "SmsError";
    this.cause = cause;
  }
}
