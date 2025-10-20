import { $inject, createDescriptor, Descriptor, KIND } from "@alepha/core";
import type { Head } from "../interfaces/Head.ts";
import { HeadProvider } from "../providers/HeadProvider.ts";

/**
 * Set global `<head>` options for the application.
 */
export const $head = (options: HeadDescriptorOptions) => {
  return createDescriptor(HeadDescriptor, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export type HeadDescriptorOptions = Head | (() => Head);

// ---------------------------------------------------------------------------------------------------------------------

export class HeadDescriptor extends Descriptor<HeadDescriptorOptions> {
  protected readonly provider = $inject(HeadProvider);
  protected onInit() {
    this.provider.global = this.options;
  }
}

$head[KIND] = HeadDescriptor;
