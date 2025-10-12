import { AlephaApiFiles } from "@alepha/api-files";
import { AlephaApiJobs } from "@alepha/api-jobs";
import { AlephaApiUsers } from "@alepha/api-users";
import { Alepha, run } from "@alepha/core";
import { AlephaReactHead } from "@alepha/react-head";
import { Api } from "./Api.ts";
import { AppRouter } from "./AppRouter.ts";

const alepha = Alepha.create();

alepha.with(AlephaReactHead);
alepha.with(AppRouter);

alepha.with(AlephaApiJobs);
alepha.with(AlephaApiFiles);
alepha.with(AlephaApiUsers);
alepha.with(Api);

run(alepha);
