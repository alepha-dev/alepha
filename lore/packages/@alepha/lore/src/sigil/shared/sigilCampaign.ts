/**
 * The campaign tag on a landing URL: `utm_campaign`, else `utm_source`.
 *
 * Both are accepted because both are how a link actually gets tagged in
 * practice — `?utm_source=hn` on a one-off post, `utm_campaign=launch` on
 * something planned — and demanding the "correct" one would silently drop
 * half the links anyone really writes.
 *
 * Returns `undefined` when neither is present, which the sink folds into
 * `none`. Values are lowercased so `HN` and `hn` are one row, and capped hard:
 * this is a dimension, so an attacker-supplied 2KB query parameter would
 * otherwise mint an unbounded number of rows.
 *
 * The other UTM fields are deliberately not collected. Each one is a whole
 * extra dimension multiplying the row count, and `medium`/`term`/`content`
 * only earn that on a site running paid acquisition.
 */
export const sigilCampaign = (search: string): string | undefined => {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return undefined;
  }
  const raw = params.get("utm_campaign") ?? params.get("utm_source");
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return undefined;
  return value.slice(0, 64);
};
