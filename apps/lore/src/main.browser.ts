import { adminRouterOptionsAtom } from "@alepha/ui/components/admin/admin-router-options";
import { Alepha, run } from "alepha";
import { ScopeGrantsProvider } from "alepha/server/links";

import { loreAdminOptions } from "@/web/admin/adminChrome.tsx";
import { LoreWebAdmin } from "@/web/admin/index.ts";

import { LoreWebApp } from "./web/app/index.ts";
import { ProjectScopeGrants } from "./web/app/services/ProjectScopeGrants.ts";

const alepha = Alepha.create();

alepha.set(adminRouterOptionsAtom, loreAdminOptions);

// What `action.can()` means inside a project.
//
// ⚠️ Declared in BOTH entries rather than in `LoreWebApp.register()`, which is
// the tempting single place and does not work: `main.server.ts` injects the
// web module last, by which point `LinkProvider` is already built and the
// substitution is a `TooLateSubstitutionError`. And it has to reach the server
// anyway - `can()` runs during render on both sides of hydration, and a
// control the server renders and the client then hides is exactly the drift
// `LinkProvider.can`'s own comment exists to prevent.
alepha.with({ provide: ScopeGrantsProvider, use: ProjectScopeGrants });

alepha.with(LoreWebApp);
alepha.with(LoreWebAdmin);

run(alepha);
