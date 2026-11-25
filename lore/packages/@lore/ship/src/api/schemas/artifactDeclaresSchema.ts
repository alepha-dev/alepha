import { type Infer, z } from "alepha";

/**
 * What one build declares, by name: the short answer a list of builds needs to
 * say what changed from one to the next (#Q4265).
 *
 * ⚠️ Names, never the manifest. The document is about 3 KB a row and a listing
 * leaves it out on purpose; this is a few hundred bytes, and only on a listing
 * that asked for it (`listArtifacts` with `declares`).
 *
 * ⚠️ `z.string()`, not `z.text()`, for the reason `artifactResourceSchema`
 * gives: a name past 255 characters would fail the whole payload.
 */
export const artifactDeclaresSchema = z.object({
  /**
   * The env variables the build reads, secrets left out.
   */
  variables: z.array(z.string()),
  secrets: z.array(z.string()),
  /**
   * The resources the build needs, by the document's own key: `database` for
   * `hasDatabase`. One it declares off is not listed.
   */
  resources: z.array(z.string()),
  crons: z.array(z.string()),
});

export type ArtifactDeclares = Infer<typeof artifactDeclaresSchema>;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((it) => typeof it === "string") : [];

const names = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((it) => (typeof it?.name === "string" ? [it.name] : []))
    : [];

/**
 * `hasDatabase` reads `database`, `hasKV` reads `kv`: the document's own keys,
 * so a resource a newer build declares still shows.
 */
export const artifactResourceName = (key: string): string =>
  key
    .replace(/^has/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();

/**
 * Reads the names out of an archive's `manifest.json`.
 *
 * ⚠️ Absent for an image, whose document is an OCI index that declares none of
 * this, and for a build with no stored manifest: unknown, never "declares
 * nothing". The document is `.loose()` and written by a build of any age, so
 * every field is read defensively.
 */
export const artifactDeclaresOf = (
  format: string,
  manifest: Record<string, any> | undefined,
): ArtifactDeclares | undefined => {
  if (!manifest || format !== "archive") {
    return undefined;
  }
  return {
    variables: names(manifest.variables),
    secrets: names(manifest.secrets),
    resources: Object.entries(manifest.resources ?? {}).flatMap(
      ([key, value]) => (value === true ? [artifactResourceName(key)] : []),
    ),
    crons: strings(manifest.crons),
  };
};
