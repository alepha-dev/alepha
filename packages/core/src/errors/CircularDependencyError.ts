export class CircularDependencyError extends Error {
	constructor(provider: string, parents?: string[]) {
		super(
			`Instance not available. Looks like a circular dependency. ? -> ${parents?.map((name) => `${name} -> `).join("")}${provider} -> ?`,
		);
	}
}
