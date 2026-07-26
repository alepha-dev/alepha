import { $atom, z } from "alepha";

/**
 * Credentials applied to every "Try It" request.
 *
 * Most of a real application's actions carry `$secure`, so without a way to
 * present a token the Try It tab can only ever exercise the public surface —
 * every other action answers 401 and the feature reads as broken.
 *
 * Dev-only and browser-local: the value is persisted to `localStorage` by the
 * Authorize sheet and never leaves the machine.
 */
export const devAuthAtom = $atom({
  name: "devtools.auth",
  schema: z.object({
    bearer: z.text().optional(),
    headers: z.array(z.object({ key: z.text(), value: z.text() })).optional(),
  }),
  default: {},
});
