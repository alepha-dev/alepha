import { $error, z } from "alepha";

/**
 * A `$lock` that could not be acquired in time.
 */
export const LockAcquireError = $error({
  name: "LOCK_ACQUIRE",
  schema: z.object({ lock: z.text() }),
  message: (data) => `$lock: could not acquire lock '${data.lock}'`,
});

export type LockAcquireError = InstanceType<typeof LockAcquireError>;
