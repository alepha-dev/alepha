import { $module } from "alepha";
import { IssueController } from "./controllers/IssueController.ts";

export * from "./entities/issueMessages.ts";
export * from "./entities/issues.ts";

export const SaasIssues = $module({
  name: "saas.api.issues",
  services: [IssueController],
});
