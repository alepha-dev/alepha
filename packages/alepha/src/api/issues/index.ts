import { $module } from "alepha";
import { AdminIssueController } from "./controllers/AdminIssueController.ts";
import { IssueController } from "./controllers/IssueController.ts";
import { IssueService } from "./services/IssueService.ts";

export * from "./controllers/AdminIssueController.ts";
export * from "./controllers/IssueController.ts";
export * from "./entities/issues.ts";
export * from "./schemas/createIssueSchema.ts";
export * from "./schemas/issueConfigAtom.ts";
export * from "./schemas/issueQuerySchema.ts";
export * from "./schemas/issueResourceSchema.ts";
export * from "./schemas/myIssueQuerySchema.ts";
export * from "./schemas/updateIssueSchema.ts";
export * from "./services/IssueService.ts";

declare module "alepha" {
  interface Hooks {
    "issue:created": {
      issue: import("./entities/issues.ts").IssueEntity;
    };
    "issue:assigned": {
      issue: import("./entities/issues.ts").IssueEntity;
      assigneeId: string;
    };
    "issue:completed": {
      issue: import("./entities/issues.ts").IssueEntity;
    };
    "issue:reopened": {
      issue: import("./entities/issues.ts").IssueEntity;
      reason: string;
    };
    "issue:archived": {
      issue: import("./entities/issues.ts").IssueEntity;
    };
    "issue:deleted": {
      issue: import("./entities/issues.ts").IssueEntity;
    };
  }
}

/**
 * Issue tracking module — submit, assign, complete, reopen, and archive issues.
 *
 * @module alepha.api.issues
 */
export const AlephaApiIssues = $module({
  name: "alepha.api.issues",
  services: [IssueService, IssueController, AdminIssueController],
  register: (alepha) => {
    alepha.with(IssueService).with(IssueController).with(AdminIssueController);
  },
});
