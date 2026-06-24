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

  if (options.schema?.body && "properties" in options.schema.body) {
    const properties: Record<string, any> = options.schema.body.properties;
    for (const key in properties) {
      if (z.schema.format(properties[key]) === "binary") {
        return true;
      }
    }
  }

  return false;
};
