/**
 * The name a person reads for an artifact's runtime.
 *
 * `workerd` is the VM a Cloudflare Worker runs in; the infrastructure it
 * names is Cloudflare, so that is what every surface prints (feedback
 * #P2193). The release tab, the project Artifacts page and an app's
 * Artifacts tab all go through this, so one runtime has one name everywhere.
 *
 * ⚠️ Only the LABEL. `workerd` stays the stored value and the value on the
 * wire: the CLI's `--runtime`, the build manifest, `ARTIFACT_RUNTIMES`,
 * `acceptedRuntimes` (a `cloudflare` estate accepts `["workerd"]`) and the
 * artifacts unique key all carry it, and renaming that is a separate,
 * cross-cutting decision. Filters and sorts keep using the value.
 */
export const artifactRuntimeLabel = (runtime: string): string =>
  runtime === "workerd" ? "cloudflare" : runtime;
