import { Alepha, run } from "alepha";

import { HelloApi } from "./app.ts";

run(Alepha.create().with(HelloApi));
