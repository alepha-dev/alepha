import type { ValueError } from "@sinclair/typebox/errors";
import { AlephaError } from "./AlephaError.ts";

export class TypeBoxError extends AlephaError {
	readonly name = "TypeBoxError";

	readonly value: ValueError;
	constructor(value: ValueError) {
		super(
			`Invalid input: ${value.message}${value.path ? ` at ${value.path}` : ""}${value.value ? `, but received ${value.value}.` : ""}`,
		);
		this.value = value;
	}
}
