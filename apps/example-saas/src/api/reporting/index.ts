import { $module } from "alepha";
import { ReportController } from "./controllers/ReportController.ts";

export const SaasReporting = $module({
  name: "saas.reporting",
  services: [ReportController],
});

export * from "./types/reports.ts";
