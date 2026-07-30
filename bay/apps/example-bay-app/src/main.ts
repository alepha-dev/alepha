import { Alepha, run } from "alepha";
import { HousekeepingJobs } from "./api/HousekeepingJobs.ts";
import { UploadsApi } from "./api/UploadsApi.ts";
import { VisitsApi } from "./api/VisitsApi.ts";
import { AppRouter } from "./web/AppRouter.ts";

const alepha = Alepha.create({
  env: { APP_NAME: "EXAMPLE_BAY_APP" },
});

alepha.with(VisitsApi);
alepha.with(UploadsApi);
alepha.with(HousekeepingJobs);
alepha.with(AppRouter);

run(alepha);
