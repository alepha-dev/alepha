/**
 * The response header carrying the build that answered, as {@link buildToken}.
 */
export const BUILD_HEADER = "x-alepha-build";

/**
 * An opaque token naming the build of this code: the same in the server and
 * the client bundle of one build, different after any rebuild. `undefined`
 * when nothing built this code (development), so nothing is compared there.
 *
 * A hash rather than the build date and commit themselves: a header on every
 * response says nothing `/version` might be configured to withhold.
 */
export const buildToken = (meta: {
  commit?: string;
  build: { dev?: boolean; date?: string };
}): string | undefined => {
  if (meta.build.dev || !meta.build.date) {
    return undefined;
  }
  const id = meta.commit
    ? `${meta.build.date}-${meta.commit}`
    : meta.build.date;

  // FNV-1a, 32 bits: an identity, not a secret.
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};
