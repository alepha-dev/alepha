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
 * ## Every other registry goes through a credential, not this list
 *
 * A private registry (GitLab, Harbor, Nexus, an Azure Container Registry, a
 * self-hosted `registry:2`) is read once the project holds a credential for
 * its host (`registry_credentials`, #Q2693): `ImageRegistryClient.parse`
 * accepts exactly that host, port included, and the read answers the
 * registry's own v2 challenge with it. This list stays the ANONYMOUS
 * allowlist, which is why it does not grow with every company registry.
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
const REGISTRY_HOSTS = ["ghcr.io"] as const;

/**
 * Whether Lore will talk to this host.
 *
 * Exact match, lowercased by the parser before it gets here. A hostname that
 * is not in the list is refused by NAME, before any fetch happens.
 */
export const isAllowedRegistryHost = (host: string): boolean =>
  (REGISTRY_HOSTS as readonly string[]).includes(host);
