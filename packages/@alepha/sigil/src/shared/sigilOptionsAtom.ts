import { $atom, type Static, z } from "alepha";

/**
 * Server-side sigil configuration — the single source of truth that replaces
 * the old `SigilForwardProvider.config`. It holds the secret `id`, so it is set
 * only in the app store (never inside a request context) and is therefore
 * **never serialized to the browser** (`exportAtoms("current")` only captures
 * per-request state).
 *
 * Populated from env at boot (`SIGIL_ID`, `LORE_URL`, `SIGIL_FEATURES`) and/or
 * from host code — e.g. `alepha.store.set(sigilOptions, { excludedPaths: [...] })`
 * to suppress the petition button on matching host pages.
 *
 * Per request, the non-secret subset (features + excludedPaths) is copied into
 * {@link sigilClientAtom} for SSR delivery to the browser.
 */
export const sigilOptions = $atom({
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
});

export type SigilOptions = Static<typeof sigilOptions.schema>;
