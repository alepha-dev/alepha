import { type Infer, z } from "alepha";

/**
 * The shapes `alepha init` can scaffold.
 *
 * Two, and deliberately not more. Every project still gets the same API +
 * web + Tailwind skeleton; a preset only decides whether the identity surface
 * — auth, account, admin — is scaffolded with it or added by hand later. The
 * argument the old `--api` / `--react` / `--tailwind` flags lost still holds
 * for everything below that line: a code base that looks different in every
 * repository costs more than the scaffolding it saves.
 *
 * - `default` — API module, web module, Tailwind. Nothing to configure.
 * - `saas` — the above plus `@alepha/ui`, `AuthRouter`, `AccountRouter`,
 *   `AdminRouter`, and the `$realm` that backs them.
 */
export const presetSchema = z.enum(["default", "saas"]);

export type Preset = Infer<typeof presetSchema>;
