import { accountRouterOptionsAtom } from "@alepha/ui/account";
import { adminRouterOptionsAtom } from "@alepha/ui/admin";
import { Alepha, run } from "alepha";

import { shopAccountOptions } from "./web/accountChrome.tsx";
import { shopAdminOptions } from "./web/adminChrome.tsx";
import { ShopWeb } from "./web/index.ts";

const alepha = Alepha.create();
alepha.with(ShopWeb);
alepha.set(adminRouterOptionsAtom, shopAdminOptions);
alepha.set(accountRouterOptionsAtom, shopAccountOptions);

run(alepha);
