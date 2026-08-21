import { $inject, createPrimitive, KIND, Primitive } from "alepha";

import type { Head } from "../interfaces/Head.ts";
import { HeadProvider } from "../providers/HeadProvider.ts";

/**
 * Set global `<head>` options for the application.
 */
export const $head = (options: HeadPrimitiveOptions) => {
  return createPrimitive(HeadPrimitive, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export type HeadPrimitiveOptions = Head | (() => Head);

// ---------------------------------------------------------------------------------------------------------------------

export class HeadPrimitive extends Primitive<HeadPrimitiveOptions> {
  protected readonly provider = $inject(HeadProvider);
  protected onInit() {
    this.provider.global = [...(this.provider.global ?? []), this.options];
  }
}

$head[KIND] = HeadPrimitive;
