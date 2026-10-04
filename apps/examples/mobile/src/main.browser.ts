import { AlephaCapacitor } from "@alepha/capacitor";
import { Alepha, run } from "alepha";

import { WebModule } from "./web/index.ts";
import { OverlayBackHandler } from "./web/services/OverlayBackHandler.ts";

const alepha = Alepha.create();

// Native capabilities, and the API origin of a capacitor-built shell. In a
// plain browser it binds web fallbacks and changes nothing.
alepha.with(AlephaCapacitor);
alepha.with(WebModule);
// The Android back button closes an open overlay before it navigates.
alepha.with(OverlayBackHandler);

run(alepha);
