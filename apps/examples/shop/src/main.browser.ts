import { adminRouterOptionsAtom } from "@alepha/ui/components/admin/admin-router-options";
import { Alepha, run } from "alepha";

import { shopAdminOptions } from "./web/adminChrome.tsx";
import { ShopWeb } from "./web/index.ts";

const alepha = Alepha.create();
alepha.with(ShopWeb);
alepha.set(adminRouterOptionsAtom, shopAdminOptions);

run(alepha);
