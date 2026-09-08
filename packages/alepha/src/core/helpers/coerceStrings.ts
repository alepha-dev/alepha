import { z } from "../providers/ZodProvider.ts";

/**
 * Coerce a single string value coming from a string-only boundary (HTTP query,
 * HTTP headers, environment variables) to the JS type its schema declares.
 *
 * This is the zod-standard `z.coerce` behavior applied only at the edges where
 * inputs are inherently strings. A JSON request body and the ORM stay strict —
 * both carry their own types — but the non-file parts of a MULTIPART body do
 * not, and are coerced here too: without it a `z.boolean()` or `z.integer()`
 * field is undeclarable in a form, since the wire can only ever deliver a
 * string for it.
 *
 * A value that cannot be coerced is returned unchanged so the subsequent
 * validation produces a proper rejection. Arrays coerce element-wise.
 */
export const coerceScalar = (schema: unknown, value: unknown): unknown => {
  const base = z.schema.unwrap(schema);

  if (z.schema.isArray(base) && Array.isArray(value)) {
    const element = (base as any).element;
    return value.map((v) => coerceScalar(element, v));
  }

  // A `z.dateRange()` arriving as `?createdAt=2026-01-01,2026-01-31`.
  //
  // ⚠️ Scoped to the format literal, deliberately. `ServerProvider
  // .parseQueryString` answers `Record<string, string>`, so a query can never
  // produce an array on its own, and the general question - should EVERY array
  // query param comma-split? - is left open rather than answered here in
  // passing. Keying on `date-range` means no existing array field changes
  // behaviour and a value containing a comma cannot start splitting by
  // surprise.
  //
  // ⚠️ **A range reaches a server in TWO shapes**, and only one of them is the
  // one this was written for. `HttpClient.queryParams` `JSON.stringify`s any
  // object-valued query param, so the framework's own client sends
  // `?createdAt=["2026-01-01","2026-01-31"]`; a hand-written URL, and
  // `AlephaTable`'s own filter serialisation, send the comma-joined form. A
  // split that ran on both would cut the JSON in half and hand the schema
  // `["[\"2026-01-01\"", …]`, which fails as "Invalid ISO date" and names
  // nothing useful. So a value that opens with `[` is left to the JSON branch
  // below, which was already going to parse it correctly.
  //
  // Otherwise the pair is split and handed on unvalidated: a wrong count or a
  // non-date half is the schema's rejection to produce, and this file's
  // contract is that anything it cannot coerce is returned for validation to
  // refuse by name.
  if (
    z.schema.isDateRange(base) &&
    typeof value === "string" &&
    value.trimStart()[0] !== "["
  ) {
    return value.split(",");
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
