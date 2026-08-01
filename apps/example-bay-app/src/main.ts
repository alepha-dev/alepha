import { AlephaSigil } from "@alepha/sigil";
import { Alepha, run } from "alepha";
import { AlephaServerMetrics } from "alepha/server/metrics";
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
// `SIGIL_SINK` points at. Without those env vars it captures locally and
// sends nothing, so adding the module is safe in any environment.
alepha.with(AlephaSigil);

// Prometheus-style runtime detail — heap, event loop, per-route latency —
// served on `/metrics`. Safe to enable because Bay refuses that path on the
// public host and reads it over loopback; on an app exposed directly it would
// hand a stranger a live readout of the process.
alepha.with(AlephaServerMetrics);

run(alepha);
