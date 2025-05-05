import type { ValueError } from "@sinclair/typebox/errors";

export class TypeBoxError extends Error {
	readonly value: ValueError;
	constructor(value: ValueError) {
		super(
			`Invalid input: ${value.message}${value.path ? ` at ${value.path}` : ""}${value.value ? `, but received ${value.value}.` : ""}`,
		);
		this.name = "TypeboxError";
		this.value = value;
	}
}
