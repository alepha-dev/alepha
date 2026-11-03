import { createPrimitive, Primitive } from "alepha";
import { KIND } from "alepha/internal";

import type { RobotsPrimitiveOptions } from "./$robots.ts";

export type { RobotsPrimitiveOptions } from "./$robots.ts";

/**
 * Browser variant of {@link $robots}: a server-only route, so a no-op that
 * keeps `$robots()` valid as an isomorphic router field.
 */
export const $robots = (
  options: RobotsPrimitiveOptions = {},
): RobotsPrimitive => {
  return createPrimitive(RobotsPrimitive, options);
};

export class RobotsPrimitive extends Primitive<RobotsPrimitiveOptions> {
  protected onInit() {
    // no-op in the browser
  }
}

$robots[KIND] = RobotsPrimitive;
