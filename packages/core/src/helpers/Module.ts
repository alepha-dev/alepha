import type { Alepha } from "../Alepha.ts";
import type { Service } from "../interfaces/Service.ts";

export interface Module {
	name?: string;
	$services: (alepha: Alepha) => void | Alepha;
}

export interface ModuleDefinition extends Module {
	services: Array<Service>;
}

// ---------------------------------------------------------------------------------------------------------------------

export const isModule = (value: unknown): value is Module => {
	return (
		typeof value === "object" &&
		value !== null &&
		"$services" in value &&
		typeof (value as Module).$services === "function"
	);
};

export const toModuleName = (name: string): string => {
	// Remove optional "Module" suffix
	name = name.replace(/Module$/, "");

	// Split PascalCase into words
	const parts = name.match(/[A-Z][a-z0-9]*/g);

	if (!parts) return name.toLowerCase();

	return parts.map((p) => p.toLowerCase()).join(".");
};
