/**
 * Module-local cache of derived `CryptoKey` instances for protected
 * folios in the current session. NOT a store atom: `CryptoKey` is an
 * opaque host object that won't serialize, and we explicitly DON'T want
 * persistence — the cache must vanish on tab close so a second visitor
 * can't skip the passphrase prompt.
 *
 * The map is shared across renders of `FolioProtectedView` and any
 * future protected-folio editor so a user who unlocked from the read
 * view doesn't have to re-enter the passphrase when they hit Edit.
 */
const cache = new Map<string, CryptoKey>();

export const getProtectedKey = (folioId: string): CryptoKey | undefined =>
  cache.get(folioId);

export const rememberProtectedKey = (folioId: string, key: CryptoKey): void => {
  cache.set(folioId, key);
};

export const forgetProtectedKey = (folioId: string): void => {
  cache.delete(folioId);
};

export const forgetAllProtectedKeys = (): void => {
  cache.clear();
};
