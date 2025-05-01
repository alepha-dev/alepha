export class AppRunError extends Error {
	constructor(
		public readonly type: string,
		public readonly module: string,
		public readonly cause: Error,
	) {
		super(`App failed to ${type} ${module}`, { cause });
		this.name = "AppRunError";
	}
}
