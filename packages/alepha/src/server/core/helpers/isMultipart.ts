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
      if (z.schema.format(properties[key]) === "binary") {
        return true;
      }
    }
  }

  return false;
};
