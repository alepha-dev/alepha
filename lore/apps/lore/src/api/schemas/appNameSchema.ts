import { z } from "alepha";

/**
 * The longest an app name may be.
 *
 * Deliberately shorter than the `sigils.name` column's own `max(100)`. The
 * column stays permissive because tightening it would make any pre-existing
 * row that violates the new rule fail to decode — and a value that fails a
 * column's schema does not read as `undefined`, it throws every query that
 * touches the table. That is the `projects.features` incident of 2026-08-05,
 * from the same direction. The constraint therefore lives on the way in, not
 * on the way out.
 */
export const APP_NAME_MAX_LENGTH = 64;

/**
 * What an app name may contain.
 *
 * The name is the app's URL segment (`/p/2/apps/lore-staging`), so it has to
 * survive a path without escaping: lowercase letters, digits and interior
 * hyphens only. Callers are expected to trim and lowercase before testing —
 * `Lore-Staging` is accepted as input and stored as `lore-staging` rather than
 * refused, because the difference is not one an operator means.
 */
export const APP_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * The length bound alone, for request bodies.
 *
 * The pattern is **not** folded in here on purpose: a schema rejection happens
 * before the handler runs, which would refuse `Lore-Staging` outright instead
 * of normalising it. The handler tests {@link APP_NAME_PATTERN} itself, after
 * normalising.
 */
export const appNameSchema = z.string().min(1).max(APP_NAME_MAX_LENGTH);
