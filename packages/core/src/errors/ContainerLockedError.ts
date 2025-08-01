export class ContainerLockedError extends Error {
	readonly name = "ContainerLockedError";

	constructor(
		message = "Container is locked. No more providers can be added.",
	) {
		super(message);
	}
}
