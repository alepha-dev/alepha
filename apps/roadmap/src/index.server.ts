import { Alepha, run } from "@alepha/core";
import { AlephaReactAuth } from "@alepha/react-auth";
import { AlephaReactForm } from "@alepha/react-form";
import { AlephaServerCompress } from "@alepha/server-compress";
import { AlephaServerHelmet } from "@alepha/server-helmet";
import { AlephaServerSecurity } from "@alepha/server-security";
import { AppRouter } from "./AppRouter.ts";
import { RoadmapApi } from "./api";
import { RoadmapServices } from "./services";

const alepha = Alepha.create({
	env: {
		APP_NAME: "RDM",
	},
});

alepha.with(AlephaReactAuth);
alepha.with(AlephaReactForm);
alepha.with(AlephaServerHelmet);
alepha.with(AlephaServerSecurity);
alepha.with(AlephaServerCompress);

alepha.with(RoadmapServices);
alepha.with(RoadmapApi);

alepha.with(AppRouter);

run(alepha);
