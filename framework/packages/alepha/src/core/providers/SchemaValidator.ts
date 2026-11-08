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
  /**
   * How many issues a `SchemaValidationError` carries at most. A form has a
   * few dozen fields; a huge array failing on every row should not ship
   * thousands of messages.
   */
  public static readonly MAX_ISSUES = 50;

  public validate<T extends ZType>(schema: T, value: unknown): Infer<T> {
    const result = schema.safeParse(value);
    if (!result.success) {
      // Map the zod issues onto the framework's validation-error contract
      // (`SchemaValidationError`), which the HTTP layer, CLI, and ORM all
      // catch. `path` / `message` stay the first issue for every reader that
      // only needs one; `issues` carries all of them, so a form can show
      // every bad field after one submit.
      const all = result.error.issues;
      const issues = all
        .slice(0, SchemaValidator.MAX_ISSUES)
        .map((issue) => this.describeIssue(issue));
      const first = issues[0] ?? { path: "", message: "Validation failed" };
      throw new SchemaValidationError({
        message: first.message,
        path: first.path,
        issues,
        params: all[0],
      });
    }
    return result.data as Infer<T>;
  }

  /**
   * One zod issue as `{ path, message }`: the path as a JSON pointer (`""`
   * for the root), and a missing required field phrased as "is required".
   */
  protected describeIssue(issue: {
    code?: string;
    path?: PropertyKey[];
    message?: string;
  }): { path: string; message: string } {
    const path = issue.path?.length ? issue.path.map(String).join("/") : "";
    let message = issue.message ?? "Validation failed";
    // zod reports a missing required field as "expected X, received
    // undefined": phrase it as a "required" rejection.
    if (
      issue.code === "invalid_type" &&
      /received undefined/i.test(message) &&
      path
    ) {
      message = `'${path}' is required`;
    }
    return { path: path ? `/${path}` : "", message };
  }

  public safeValidate<T extends ZType>(schema: T, value: unknown) {
    return schema.safeParse(value);
  }

  /**
   * Zod schemas are immutable — clone is a pass-through.
   */
  public clone<T extends ZType>(schema: T): T {
    return schema;
  }
}
