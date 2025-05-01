export class ContainerLockedError extends Error {
	constructor(
		message = "Container is locked. No more providers can be added.",
	) {
		super(message);
	}
}
