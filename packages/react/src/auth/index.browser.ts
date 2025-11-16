import { $module, type Alepha } from "alepha";
import { ReactAuth } from "./services/ReactAuth.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaReactAuth = $module({
  name: "alepha.react.auth",
  descriptors: [],
  register: (alepha: Alepha) => {
    alepha.with(ReactAuth);
  },
});
