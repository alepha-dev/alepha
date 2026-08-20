import { z } from "../providers/ZodProvider.ts";

/**
 * Coerce a single string value coming from a string-only boundary (HTTP query,
 * HTTP headers, environment variables) to the JS type its schema declares.
 *
 * This is the zod-standard `z.coerce` behavior applied only at the edges where
 * inputs are inherently strings — request bodies and the ORM stay strict. A
 * value that cannot be coerced is returned unchanged so the subsequent
 * validation produces a proper rejection. Arrays coerce element-wise.
 */
export const coerceScalar = (schema: unknown, value: unknown): unknown => {
  const base = z.schema.unwrap(schema);

  if (z.schema.isArray(base) && Array.isArray(value)) {
    const element = (base as any).element;
    return value.map((v) => coerceScalar(element, v));
  }

  // Env maps (and other string-only boundaries) may carry already-typed
  // scalars (e.g. `PORT: 3000`, `DEBUG: true`). When the schema declares a
  // string/text field, stringify them so strict validation passes and `$KEY`
  // substitution sees a string source.
  if (
    z.schema.isString(base) &&
    (typeof value === "number" || typeof value === "boolean")
  ) {
    return String(value);
  }

  if (typeof value !== "string") {
    return value;
  }

  if (z.schema.isInteger(base) || z.schema.isNumber(base)) {
    const n = Number(value);
    return value.trim() !== "" && !Number.isNaN(n) ? n : value;
  }

  if (z.schema.isBoolean(base)) {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }

  // A structured value arriving down a string-only wire: an env var holding
  // JSON, a query parameter carrying an object. Without this, declaring
  // `z.object()` for such a field can only ever fail — the schema wants an
  // object and the boundary can only deliver a string, so the field is
  // undeclarable rather than merely awkward.
  //
  // Guarded on the first character so an ordinary string is never fed to
  // `JSON.parse` on the off-chance it parses: `"null"`, `"7"` and `"true"` are
  // all valid JSON documents, and a schema expecting an object should reject
  // them by their own type rather than be handed the wrong one. Malformed input
  // is returned as it came, per this file's contract — which is what turns a
  // stray comma in a dashboard textarea into a validation error naming the
  // variable, instead of an exception thrown from a parser nobody called.
  if (z.schema.isObject(base) || z.schema.isArray(base)) {
    // Empty means absent, which for a structured field is the only reading
    // that can be right: `""` is not a document, so it could otherwise do
    // nothing but fail validation.
    //
    // It is also the shape every CI system produces for a secret that is not
    // set. `${{ secrets.MISSING }}` interpolates to the empty string, so
    // deleting a secret while its workflow line stands used to turn a variable
    // that had been optional all along into a boot-time SchemaValidationError.
    // Removing an optional variable should not be able to take an app down.
    if (value.trim() === "") {
      return undefined;
    }

    const first = value.trimStart()[0];
    if (first === "{" || first === "[") {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
  }

  return value;
};

/**
 * Coerce each declared field of an object against its object schema. Used to
 * normalize string-only boundary maps (env vars, query objects) before strict
 * validation. Undeclared keys are passed through untouched.
 */
export const coerceObject = (
  schema: unknown,
  value: Record<string, unknown>,
): Record<string, unknown> => {
  const shape = (schema as any)?.shape;
  if (!shape) {
    return value;
  }

  const out: Record<string, unknown> = { ...value };
  for (const key of Object.keys(shape)) {
    if (out[key] != null) {
      out[key] = coerceScalar(shape[key], out[key]);
    }
  }
  return out;
};
