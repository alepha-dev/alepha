import { Alepha, run } from "alepha";

import { RowsRouter } from "./RowsRouter.ts";

run(Alepha.create().with(RowsRouter));
