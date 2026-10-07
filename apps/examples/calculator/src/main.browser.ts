import { AlephaCapacitor } from "@alepha/capacitor";
import { Alepha, run } from "alepha";

import { WebModule } from "./web/index.ts";

const alepha = Alepha.create();

// Native capabilities (haptics, status bar, splash, back button). In a plain
// browser it binds web fallbacks and changes nothing.
alepha.with(AlephaCapacitor);
alepha.with(WebModule);

run(alepha);
