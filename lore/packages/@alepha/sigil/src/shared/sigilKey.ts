/** What every sigil token starts with, whatever mints it. */
export const SIGIL_KEY_PREFIX = "sg_";

/**
 * Slugs a sigil key may name.
 *
 * Deliberately the same shape a sink is expected to produce, not a permissive
 * "anything up to the separator". The slug is interpolated into the feedback
 * URL, so a key carrying `..%2Fsomewhere` would point every reader of the app
 * at a path its operator never chose. A key is operator-supplied rather than
 * hostile input, but the check is one expression and it turns a typo into a
 * missing button instead of a wrong destination.
 */
const SLUG = /^[a-z0-9-]{1,64}$/;

/**
 * Builds the token an app is enrolled with: `sg_<slug>_<secret>`.
 *
 * The slug rides in the credential because it is the only thing the app needs
 * from the sink before it can render, and the alternative was naming it a
 * second time in `SIGIL_CONFIG` where it could disagree. Nothing is protected
 * by it being there: the slug is already public, printed into the feedback link
 * on every page. Only the secret half authorises anything.
 *
 * `_` separates the two, and the safety of that is a property of the slug
 * rather than of the format. The secret is base64url, whose alphabet includes
 * `_` and `-`, so about two secrets in five contain a separator of their own.
 * Slugs cannot: `[a-z0-9-]` only. So the FIRST `_` after the prefix ends the
 * slug and everything after it is the secret, however many more it holds.
 *
 * Which is why nothing here ever calls `split("_")`. A `split` with a length
 * check reads correctly and rejects a random 40% of valid tokens.
 */
export const sigilKeyBuild = (slug: string, secret: string): string =>
  `${SIGIL_KEY_PREFIX}${slug}_${secret}`;

/**
 * The project a key names, or `undefined` if it names none.
 *
 * `undefined` is a supported answer, not a failure. Keys minted before the slug
 * moved into the token are still perfectly good credentials: the sink resolves
 * them by hash and has never needed the app to say which project it is. Such an
 * app keeps reporting and loses only its feedback link, which is the correct
 * half to lose, because the link is the only thing the slug was ever for.
 */
export const sigilKeyProject = (
  key: string | undefined,
): string | undefined => {
  if (!key?.startsWith(SIGIL_KEY_PREFIX)) {
    return undefined;
  }
  const rest = key.slice(SIGIL_KEY_PREFIX.length);
  const end = rest.indexOf("_");
  if (end <= 0) {
    return undefined;
  }
  const slug = rest.slice(0, end);
  return SLUG.test(slug) ? slug : undefined;
};

/**
 * How much of a token is safe to store and show.
 *
 * The sink keeps this so its UI can name a credential it cannot reproduce. It
 * has to be derived rather than a fixed slice: `token.slice(0, 11)` was right
 * when every token was `sg_` plus 32 random characters, and is wrong the moment
 * a variable-length slug sits between them. On a short slug that offset reaches
 * past the separator and files several characters of the SECRET in a readable
 * column; on a long one it truncates the only part worth showing.
 *
 * So: the whole namespace, plus a glimpse of the secret to tell two keys of one
 * project apart. A key with no slug falls back to the old shape, which is what
 * it is.
 */
export const sigilKeyPrefix = (key: string): string => {
  const slug = sigilKeyProject(key);
  if (!slug) {
    return key.slice(0, 11);
  }
  return key.slice(0, SIGIL_KEY_PREFIX.length + slug.length + 1 + 4);
};
