import { z } from "alepha";
import type { RequestConfigSchema } from "../interfaces/ServerRequest.ts";

/**
 * Checks if the route has multipart/form-data request body.
 */
export const isMultipart = (options: {
  schema?: RequestConfigSchema;
  contentType?: string;
  requestBodyType?: string;
}): boolean => {
  if (
    options.contentType === "multipart/form-data" ||
    options.requestBodyType === "multipart/form-data"
  ) {
    return true;
  }

  // `z.schema.isObject`, not `"properties" in body`: that spelling tested for
  // the presence of a prototype alias rather than for an object schema, so it
  // silently answered false the moment the alias went away — and a route with
  // a file field stopped being treated as multipart.
  if (options.schema?.body && z.schema.isObject(options.schema.body)) {
    const properties = z.schema.shape(options.schema.body);
    for (const key in properties) {
      // `stream` as well as `binary`: a route that takes its bytes in flight is
      // just as multipart as one that takes them buffered. This predicate is
      // read at BOTH ends — the client builds the FormData from it, the server
      // decides to parse one — so missing a format means the two agree to do
      // nothing, and the upload silently arrives as an ordinary body.
      //
      // `unwrap` first: `.optional()` returns a NEW ZodOptional whose own
      // `.meta()` is empty, so the `format: "binary"` tag sits on the schema
      // *inside* the wrapper. Reading the wrapper answered undefined, which
      // made `z.file().optional()` — an upload that is merely not mandatory —
      // silently not multipart at either end.
      const format = z.schema.format(z.schema.unwrap(properties[key]));
      if (format === "binary" || format === "stream") {
        return true;
      }
    }
  }

  return false;
};
