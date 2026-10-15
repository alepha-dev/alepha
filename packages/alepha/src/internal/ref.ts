import type { Alepha, Service } from "alepha";

import { MODULE } from "./MODULE.ts";

/**
 * Mutable primitive-construction cursor. Internal, with no semver guarantee.
 * Alepha restores it after synchronous service construction, including errors.
 * Applications write primitives through `$context()` instead.
 */
export const __alephaRef: {
  alepha?: Alepha;
  service?: Service & { [MODULE]?: Service };
  parent?: Service;
} = {};
