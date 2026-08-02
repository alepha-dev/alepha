import { $atom, type Infer, z } from "alepha";

/**
 * The host app's own opinion about what it reports — the only knob the app
 * owner turns, as opposed to the ones the sink dictates.
 *
 * Everything else about what gets collected comes from the sink at runtime
 * (`GET /sigils/config`, cached in `SigilSinkProvider`), because a kill-switch
 * that needs a redeploy is a kill-switch nobody reaches in time.
 * `excludedPaths` is the exception: only the app knows which of its own routes
 * carry an id, a token or a name in the path, and the sink has no business
 * being told.
 *
 * Set from host code, never from env:
 *
 * ```ts
 * alepha.store.set(sigilOptions, { excludedPaths: ["/reset-password/*"] });
 * ```
 *
 * `serverOnly` is belt-and-braces rather than a confidentiality boundary: the
 * atom once held a secret sigil id, and no longer does. `excludedPaths` itself
 * is copied verbatim into {@link sigilClientAtom} and hydrated into the page,
 * because `SigilRoot` has to apply it in the browser — so treat the list as
 * public and keep secrets out of it. The credential lives in `SIGIL_KEY` and
 * never touches this atom.
 */
export const sigilOptions = $atom({
  name: "alepha.sigil.options",
  description:
    "Server-side sigil config: which of the app's own paths are never reported. Not serialized to the browser.",
  schema: z.object({
    excludedPaths: z.array(z.string()).optional(),
  }),
  default: {},
  serverOnly: true,
});

export type SigilOptions = Infer<typeof sigilOptions.schema>;
