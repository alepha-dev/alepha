import { $atom, z } from "alepha";

/**
 * The resource resolved by `$owns` for the current request.
 *
 * Request-scoped: `$owns` runs inside the host primitive's `$scope`, so
 * concurrent requests never observe each other's row.
 *
 * `serverOnly` because a resolved row is the raw database record — it may
 * carry columns the caller is not entitled to see, and this atom must never
 * be serialized into the SSR hydration payload.
 */
export const currentResourceAtom = $atom({
  name: "alepha.security.currentResource",
  schema: z.record(z.text(), z.any()).optional(),
  serverOnly: true,
});
