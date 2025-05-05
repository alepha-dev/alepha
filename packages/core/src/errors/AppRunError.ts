export class AppRunError extends Error {
	public readonly type: string;
	public readonly module: string;
	public readonly cause: Error;

	constructor(type: string, module: string, cause: Error) {
		super(`App failed to ${type} ${module}`, { cause });
		this.name = "AppRunError";
		this.cause = cause;
		this.module = module;
		this.type = type;
	}
}
