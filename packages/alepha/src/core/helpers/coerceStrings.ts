import { z } from "../providers/TypeProvider.ts";

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
