import { z } from "alepha";

/**
 * The longest a release tag may be.
 *
 * Deliberately shorter than the `releases.tag` column's own `max(100)`. The
 * column stays permissive because tightening it would make any pre-existing
 * row that violates the new rule fail to decode — and a value that fails a
 * column's schema does not read as `undefined`, it throws every query that
 * touches the table. That is the `projects.features` incident of 2026-08-05,
 * from the same direction. The constraint therefore lives on the way in, not
 * on the way out.
 */
export const RELEASE_TAG_MAX_LENGTH = 64;

/**
 * What a release tag may contain.
 *
 * The tag is the release's URL segment (`/alepha/releases/0.28.0`), so it has
 * to survive a path without escaping: letters, digits and interior `.`, `_`
 * or `-`. Accepts `0.28.0`, `v1.0.0-rc.1`, `demo-1`, `RC1`; rejects `1.0.`,
 * `v1.0/beta` and anything with a space, all of which would make the detail
 * page unreachable.
 *
 * ⚠️ **Case is preserved**, which is where this deliberately diverges from
 * {@link APP_NAME_PATTERN}: an app name is lowercased on the way in, a tag is
 * not. The tag is the join key to `artifacts.tag`, which CI derives from a git
 * tag byte for byte, so lowercasing would silently break the join for any
 * project that tags `RC1` or `V2`. Consistency with app names is worth less
 * than a join that works.
 *
 * `+` is excluded even though semver allows it for build metadata: it is legal
 * in a path segment but decoded as a space by enough naive parsers to be a bad
 * default. Admitting it later is a plain widening of this pattern.
 */
export const RELEASE_TAG_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

/**
 * The length bound alone, for request bodies.
 *
 * The pattern is **not** folded in here, for the reason `appNameSchema` writes
 * down: a schema rejection happens before the handler runs, so the handler
 * could not trim first. The handler tests {@link RELEASE_TAG_PATTERN} itself.
 */
export const releaseTagSchema = z.string().min(1).max(RELEASE_TAG_MAX_LENGTH);
