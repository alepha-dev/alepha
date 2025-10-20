import { AlephaApiFiles } from "@alepha/api-files";
import { AlephaApiJobs } from "@alepha/api-jobs";
import { Alepha, run } from "@alepha/core";
import { AlephaReactHead } from "@alepha/react-head";
import { AlephaServerSwagger } from "@alepha/server-swagger";
import { Api } from "./Api.ts";
import { AppRouter } from "./AppRouter.ts";

const alepha = Alepha.create({
	env: {
		DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/postgres",
		POSTGRES_SCHEMA: "playground",
	},
});

alepha.with(AlephaReactHead);
alepha.with(AppRouter);

alepha.with(AlephaServerSwagger);
alepha.with(AlephaApiJobs);
alepha.with(AlephaApiFiles);
alepha.with(Api);

run(alepha);
