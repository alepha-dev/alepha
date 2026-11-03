import { $inject, createPrimitive, Primitive } from "alepha";
import { KIND } from "alepha/internal";
import { HeadProvider } from "alepha/react/head";

import type { ManifestPrimitiveOptions } from "./$manifest.ts";

export type {
  ManifestIcon,
  ManifestPrimitiveOptions,
  ManifestScreenshot,
} from "./$manifest.ts";

/**
 * Browser variant of {@link $manifest}: the route is the server's, and the
 * head link stays here, so a client render keeps it.
 */
export const $manifest = (
  options: ManifestPrimitiveOptions,
): ManifestPrimitive => {
  return createPrimitive(ManifestPrimitive, options);
};

export class ManifestPrimitive extends Primitive<ManifestPrimitiveOptions> {
  protected readonly head = $inject(HeadProvider);

  protected onInit() {
    this.head.global = [
      ...(this.head.global ?? []),
      {
        link: [
          {
            rel: "manifest",
            href: this.options.path ?? "/manifest.webmanifest",
          },
        ],
      },
    ];
  }
}

$manifest[KIND] = ManifestPrimitive;
