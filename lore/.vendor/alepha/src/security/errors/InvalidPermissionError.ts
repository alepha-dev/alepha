export class InvalidPermissionError extends Error {
  constructor(name: string) {
    super(`Permission '${name}' is invalid`);
  }
}
