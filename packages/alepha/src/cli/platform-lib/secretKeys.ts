import type { BuildManifest } from "alepha/cli";
import type { FileSystemProvider } from "alepha/system";

/**
 * The env keys no adapter pushes as a runtime secret.
 *
 * Two groups, both of which the platform decides rather than the app:
 *
 * - **Binding/build vars.** The deploy target supplies these itself —
 *   `DATABASE_URL` from a D1 binding or Bay's managed SQLite, `SERVER_PORT`
 *   from whatever allocated it. Pushing the local value would point a
 *   deployed app at a development machine.
 * - **Framework infra knobs.** `LOG_LEVEL`, `DEBUG` and friends all have
 *   defaults, and a build manifest's `env` auto-list surfaces every declared
 *   `$env` key — so they have to be excluded here to keep a CI runner's own
 *   environment out of the push.
 *
 * Lives on its own rather than on {@link CloudflareAdapter} because a second
 * adapter needs the same answer. Two hand-maintained copies of a list like this
 * drift silently: the copy that is missing a key does not fail, it pushes one
 * more secret than it should, and nothing says so until a deployed app is
 * reading a laptop's `DATABASE_URL`.
 */
export const EXCLUDED_SECRET_KEYS: ReadonlySet<string> = new Set([
  "DATABASE_URL",
  "R2_BUCKET_NAME",
  "CLOUDFLARE_ANALYTICS_DATASET",
  "CLOUDFLARE_DOMAIN",
  "CLOUDFLARE_ZONE",
  "CLOUDFLARE_JURISDICTION",
  "HYPERDRIVE_ID",
  "POSTGRES_SCHEMA",
  "NODE_ENV",
  // Framework infra knobs (have defaults, never worker secrets). The
  // manifest's `env` auto-list surfaces every declared `$env` key, so
  // exclude these here to keep them out of the secret push even when a CI
  // runner happens to set them (LOG_LEVEL, DEBUG, etc.).
  "LOG_LEVEL",
  "LOG_FORMAT",
  "SERVER_HOST",
  "SERVER_PORT",
  "TRUST_PROXY",
  "REACT_SSR_ENABLED",
  "DATABASE_SYNC",
  "DEBUG",
]);

/**
 * Every key the app declares via `$env`, read from `dist/manifest.json`.
 *
 * This is the **allowlist**, and it is what makes reading `process.env` safe at
 * all: the key set comes from what the app declared at build time, never from
 * enumerating the deploying shell. A CI runner can therefore deliver secrets
 * through the job environment with no `.env` file on disk, and `PATH`,
 * `GITHUB_TOKEN` or `AWS_SECRET_ACCESS_KEY` still have no way in — they are not
 * on the list, so they are never looked up.
 *
 * Returns `undefined` when the manifest is absent or predates the `env` field,
 * so the caller falls back to the `.env` file's own keys.
 */
export async function readManifestEnvKeys(
  fs: FileSystemProvider,
  root: string,
): Promise<string[] | undefined> {
  try {
    const manifest = await fs.readJsonFile<Partial<BuildManifest>>(
      fs.join(root, "dist", "manifest.json"),
    );
    return Array.isArray(manifest.env) ? manifest.env : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What one adapter's `secrets()` step actually decided to push.
 */
export interface SecretSelection {
  /**
   * Key → value, ready to hand to the platform.
   */
  secrets: Record<string, string>;
  /**
   * Keys that were on the allowlist and dropped because the platform owns
   * them. Kept so an adapter can say so out loud — a user who put
   * `DATABASE_URL` in `.env.production` and cannot find it on the host is owed
   * a sentence, not silence.
   */
  platformOwned: string[];
}

/**
 * Resolves an allowlist of keys into the values to push.
 *
 * The security boundary of every `secrets()` implementation, in one place so
 * the adapters cannot come to differ on it. Three rules, in order:
 *
 * - a key the platform owns is dropped, and reported;
 * - a `VITE_*` key is dropped silently — Vite inlines it at build time, so it
 *   is never a runtime secret on any platform;
 * - the value is the `.env.<env>[.local]` one, falling back to `process.env`,
 *   and an empty result is dropped.
 *
 * `process.env` is read only for a key that is ALREADY on `keys`. Callers must
 * keep it that way: derive `keys` from the manifest, the config or the `.env`
 * file — never from `process.env` itself, which would put the whole deploying
 * environment in scope.
 */
export function selectSecrets(options: {
  keys: string[];
  envVars: Record<string, string>;
  excluded?: ReadonlySet<string>;
}): SecretSelection {
  const excluded = options.excluded ?? EXCLUDED_SECRET_KEYS;
  const secrets: Record<string, string> = {};
  const platformOwned: string[] = [];
  for (const key of options.keys) {
    if (excluded.has(key)) {
      platformOwned.push(key);
      continue;
    }
    if (key.startsWith("VITE_")) continue;
    const value = options.envVars[key] ?? process.env[key];
    if (!value) continue;
    secrets[key] = value;
  }
  return { secrets, platformOwned };
}
