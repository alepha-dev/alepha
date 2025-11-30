import { $module } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaServerLinks } from "alepha/server/links";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaReact = $module({
  name: "alepha.react",
  primitives: [],
  services: [

  ],
  register: (alepha) =>
    alepha
      .with(AlephaDateTime)
      .with(AlephaServerLinks)
});
