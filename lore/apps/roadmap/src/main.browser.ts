import { AlephaReactAuth } from "@alepha/react/auth";
import { AlephaReactForm } from "@alepha/react/form";
import { AlephaUI } from "@alepha/ui";
import { AlephaUIAuth } from "@alepha/ui/auth";
import { Alepha, run } from "alepha";
import { AppRouter } from "./AppRouter.ts";
import { RoadmapServices } from "./services/index.ts";

const alepha = Alepha.create({
  env: {
    LOG_LEVEL: "trace",
  },
});

alepha.with(AlephaReactAuth);
alepha.with(AlephaReactForm);
alepha.with(RoadmapServices);
alepha.with(AlephaUI);
alepha.with(AlephaUIAuth);

alepha.with(AppRouter);

run(alepha);
