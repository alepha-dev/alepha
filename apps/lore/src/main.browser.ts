import { adminRouterOptionsAtom } from "@alepha/ui/components/admin/admin-router-options";
import { Alepha, run } from "alepha";
import { loreAdminOptions } from "@/web/admin/adminChrome.tsx";
import { LoreWebAdmin } from "@/web/admin/index.ts";
import { LoreWebApp } from "./web/app/index.ts";

const alepha = Alepha.create();

alepha.set(adminRouterOptionsAtom, loreAdminOptions);

alepha.with(LoreWebApp);
alepha.with(LoreWebAdmin);

run(alepha);
