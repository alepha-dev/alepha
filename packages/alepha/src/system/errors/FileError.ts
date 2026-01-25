export class FileError extends Error {
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "FileError";
    this.cause = cause;
  }
}
