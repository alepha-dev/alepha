import { $error } from "alepha";

/**
 * A cache provider failure.
 */
export const CacheError = $error({
  name: "CACHE",
  message: "Cache error",
});

export type CacheError = InstanceType<typeof CacheError>;
