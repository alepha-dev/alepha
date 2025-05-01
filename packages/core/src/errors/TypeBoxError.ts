import type { ValueError } from "@sinclair/typebox/errors";

export class TypeBoxError extends Error {
	constructor(public value: ValueError) {
		super(
			`Invalid input: ${value.message}${value.path ? ` at ${value.path}` : ""}${value.value ? `, but received ${value.value}.` : ""}`,
		);
		this.name = "TypeboxError";
	}
}
