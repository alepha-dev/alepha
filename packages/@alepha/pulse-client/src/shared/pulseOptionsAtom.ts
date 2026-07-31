import { $atom, type Static, z } from "alepha";

/**
 * Server-side sigil configuration — the single source of truth that replaces
 * the old `PulseSinkProvider.config`. It holds the secret `id`, so it is
 * declared `serverOnly` and **never serialized to the browser**.
 *
 * Two things keep it server-side, and only one of them is a guarantee. It is
 * set exclusively in the app store, never inside a request context, so
 * `exportAtoms("current")` — which reads only the current ALS layer — would
 * skip it anyway; but that is a convention a future boot-order change or an
 * in-request `store.set` could silently break. `serverOnly: true` is the part
 * that actually holds: the atom is excluded from the hydration payload
 * unconditionally, and DevTools redacts its value from `/metadata`.
 *
 * Populated from env at boot (`SIGIL_ID`, `LORE_URL`, `SIGIL_FEATURES`) and/or
 * from host code — e.g. `alepha.store.set(pulseOptions, { excludedPaths: [...] })`
 * to suppress the petition button on matching host pages.
 *
 * Per request, the non-secret subset (features + excludedPaths) is copied into
 * {@link pulseClientAtom} for SSR delivery to the browser.
 */
export const pulseOptions = $atom({
  name: "alepha.sigil.options",
  description:
    "Server-side sigil config: id + loreOrigin + features + excludedPaths. Never serialized — holds the secret id.",
  schema: z.object({
    id: z.string().optional(),
    loreOrigin: z.string().optional(),
    features: z.array(z.string()).optional(),
    excludedPaths: z.array(z.string()).optional(),
  }),
  default: {},
  serverOnly: true,
});

export type SigilOptions = Static<typeof pulseOptions.schema>;
