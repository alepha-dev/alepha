import { AlephaApiFiles } from "@alepha/api-files";
import { AlephaApiGtfs } from "@alepha/api-gtfs";
import { AlephaApiJobs } from "@alepha/api-jobs";
import { AlephaApiNotifications } from "@alepha/api-notifications";
import { AlephaApiUsers } from "@alepha/api-users";
import { Alepha, run } from "@alepha/core";
import { AlephaReactHead } from "@alepha/react-head";
import { AlephaServerSwagger } from "@alepha/server-swagger";
import { Api } from "./Api.ts";
import { AppRouter } from "./AppRouter.ts";

const alepha = Alepha.create();

alepha.with(AlephaReactHead);
alepha.with(AppRouter);

alepha.with(AlephaServerSwagger);
alepha.with(AlephaApiNotifications);
alepha.with(AlephaApiJobs);
alepha.with(AlephaApiFiles);
alepha.with(AlephaApiUsers);
alepha.with(AlephaApiGtfs);
alepha.with(Api);

run(alepha);
