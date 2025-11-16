import { AlephaError } from "./AlephaError.ts";

export class TooLateSubstitutionError extends AlephaError {
  readonly name = "TooLateSubstitutionError";

  constructor(original: string, substitution: string) {
    super(
      `Service already substituted. Please, substitute Service '${original}' with Service '${substitution}' before using it.`,
    );
  }
}
