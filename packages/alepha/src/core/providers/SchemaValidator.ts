import { SchemaValidationError } from "../errors/SchemaValidationError.ts";
import type { Infer, ZType } from "./ZodProvider.ts";

/**
 * Validates + coerces a value against a zod schema.
 *
 * Trimming / lowercasing / defaults / unknown-key stripping all live in the
 * schema itself now (zod), so this is a thin wrapper over `schema.parse`.
 * No compile step, no `eval` - safe inside Cloudflare Workers.
 */
export class SchemaValidator {
  public validate<T extends ZType>(schema: T, value: unknown): Infer<T> {
    const result = schema.safeParse(value);
    if (!result.success) {
      // Map the first zod issue onto the framework's validation-error contract
      // (`SchemaValidationError`), which the HTTP layer, CLI, and ORM all catch.
      const issue = result.error.issues[0];
      const path = issue?.path?.length ? issue.path.join("/") : "";
      let message = issue?.message ?? "Validation failed";
      // zod reports a missing required field as "expected X, received
      // undefined" — phrase it as a "required" rejection.
      if (
        issue?.code === "invalid_type" &&
        /received undefined/i.test(message) &&
        path
      ) {
        message = `'${path}' is required`;
      }
      throw new SchemaValidationError({
        message,
        instancePath: path ? `/${path}` : "",
        params: issue,
      });
    }
    return result.data as Infer<T>;
  }

  public safeValidate<T extends ZType>(schema: T, value: unknown) {
    return schema.safeParse(value);
  }

  /** Zod schemas are immutable — clone is a pass-through. */
  public clone<T extends ZType>(schema: T): T {
    return schema;
  }
}
