import { AlephaReactAuth } from "@alepha/react/auth";
import { AlephaReactForm } from "@alepha/react/form";
import { AlephaUI } from "@alepha/ui";
import { Alepha, run } from "alepha";
import { AppRouter } from "./AppRouter.ts";
import { RoadmapServices } from "./services/index.ts";

const alepha = Alepha.create();

alepha.with(AlephaReactAuth);
alepha.with(AlephaReactForm);
alepha.with(RoadmapServices);
alepha.with(AlephaUI);

alepha.with(AppRouter);

run(alepha);
