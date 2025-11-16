import { AlephaError } from "./AlephaError.ts";

export class CircularDependencyError extends AlephaError {
  readonly name = "CircularDependencyError";

  constructor(provider: string, parents?: string[]) {
    super(
      `Instance not available. Looks like a circular dependency. ? -> ${parents?.map((name) => `${name} -> `).join("")}${provider} -> ?`,
    );
  }
}
