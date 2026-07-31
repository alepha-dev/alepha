import { AlephaTelemetry } from "@alepha/telemetry";
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

// Reports views, vitals, errors and server metrics to whatever
// `TELEMETRY_SINK` points at. Without those env vars it captures locally and
// sends nothing, so adding the module is safe in any environment.
alepha.with(AlephaTelemetry);

run(alepha);
