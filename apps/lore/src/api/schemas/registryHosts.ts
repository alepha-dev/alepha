/**
 * The container registries Lore will fetch an image's own claims from.
 *
 * ## ⚠️ A named module rather than a condition, and that is the point
 *
 * ONE entry today, and it is going to be two. A custom registry is wanted -
 * Azure Container Registry, for the Etihad case - and it is deliberately a
 * later epic. Written as a `host === "ghcr.io"` inside the parser, adding the
 * second would read as a condition somebody edited; written here it reads as
 * a decision somebody reviewed, which is the same reason `acceptedRuntimes`
 * is a module of its own.
 *
 * ## ⚠️ Widening this alone will NOT reach an Azure Container Registry
 *
 * An ACR is private, and Lore holds no registry credentials at all. Adding
 * `*.azurecr.io` here would produce a 401 on the token exchange and nothing
 * else. That later epic is **the host list AND credential storage, together**;
 * this file is half of it, and the other half is why the token exchange in
 * `ImageRegistryClient` sits behind a seam that could return an authenticated
 * token instead of an anonymous one.
 *
 * ## What a host has to be
 *
 * A registry Lore fetches from is a caller-supplied destination: nothing else
 * in Lore takes a string from a request and decides which host the Worker then
 * calls. So the list is an exact-match allowlist of bare hostnames - never a
 * suffix match, which `evil-ghcr.io` and `ghcr.io.attacker.test` both defeat -
 * and the parser refuses a port, an IP literal and any scheme of its own
 * before it consults this at all.
 */
export const REGISTRY_HOSTS = ["ghcr.io"] as const;

/**
 * Whether Lore will talk to this host.
 *
 * Exact match, lowercased by the parser before it gets here. A hostname that
 * is not in the list is refused by NAME, before any fetch happens.
 */
export const isAllowedRegistryHost = (host: string): boolean =>
  (REGISTRY_HOSTS as readonly string[]).includes(host);
