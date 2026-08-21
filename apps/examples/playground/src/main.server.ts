import { adminRouterOptionsAtom } from "@alepha/ui/components/admin/admin-router-options";
import { Alepha, run } from "alepha";

import { PlaygroundApi } from "./api/index.ts";
import { playgroundAdminOptions } from "./web/adminChrome.tsx";
import { PlaygroundWeb } from "./web/index.ts";

const alepha = Alepha.create();
alepha.with(PlaygroundApi);
alepha.with(PlaygroundWeb);
alepha.set(adminRouterOptionsAtom, playgroundAdminOptions);

run(alepha);
