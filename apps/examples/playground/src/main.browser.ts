import { adminRouterOptionsAtom } from "@alepha/ui/components/admin/admin-router-options";
import { Alepha, run } from "alepha";
import { playgroundAdminOptions } from "./web/adminChrome.tsx";
import { PlaygroundWeb } from "./web/index.ts";

const alepha = Alepha.create();
alepha.with(PlaygroundWeb);
alepha.set(adminRouterOptionsAtom, playgroundAdminOptions);

run(alepha);
