import { Alepha, run } from "@alepha/core";
import { AlephaReactAuth } from "@alepha/react-auth";
import { AlephaReactForm } from "@alepha/react-form";
import { AppRouter } from "./AppRouter.ts";
import { RoadmapServices } from "./services";

const alepha = Alepha.create();

alepha.with(AlephaReactAuth);
alepha.with(AlephaReactForm);
alepha.with(RoadmapServices);

alepha.with(AppRouter);

run(alepha);
