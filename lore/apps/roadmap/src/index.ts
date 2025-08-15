import { Alepha, run } from "@alepha/core";
import { AlephaReactAuth } from "@alepha/react-auth";
import { FocusStyleManager } from "@blueprintjs/core";
import { AppRouter } from "./AppRouter.ts";
import { RoadmapServices } from "./services";

const alepha = Alepha.create();

alepha.with(AlephaReactAuth);
alepha.with(RoadmapServices);

alepha.with(AppRouter);

FocusStyleManager.onlyShowFocusOnTabs();

run(alepha);
