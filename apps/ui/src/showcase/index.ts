import { $module } from "alepha";
import { AlephaServerLinks } from "alepha/server/links";

import { ShowcaseAnalytics } from "./admin/ShowcaseAnalytics.ts";
import { ShowcaseAnalyticsController } from "./admin/ShowcaseAnalyticsController.ts";
import { ShowcaseAudits } from "./admin/ShowcaseAudits.ts";
import { ShowcaseAuditsController } from "./admin/ShowcaseAuditsController.ts";
import { ShowcaseFiles } from "./admin/ShowcaseFiles.ts";
import { ShowcaseFilesController } from "./admin/ShowcaseFilesController.ts";
import { ShowcaseIdentitiesController } from "./admin/ShowcaseIdentitiesController.ts";
import { ShowcaseJobs } from "./admin/ShowcaseJobs.ts";
import { ShowcaseJobsController } from "./admin/ShowcaseJobsController.ts";
import { ShowcaseKeys } from "./admin/ShowcaseKeys.ts";
import { ShowcaseKeysController } from "./admin/ShowcaseKeysController.ts";
import { ShowcaseNotifications } from "./admin/ShowcaseNotifications.ts";
import { ShowcaseNotificationsController } from "./admin/ShowcaseNotificationsController.ts";
import { ShowcaseParameters } from "./admin/ShowcaseParameters.ts";
import { ShowcaseParametersController } from "./admin/ShowcaseParametersController.ts";
import { ShowcasePayments } from "./admin/ShowcasePayments.ts";
import { ShowcasePaymentsController } from "./admin/ShowcasePaymentsController.ts";
import { ShowcaseSessions } from "./admin/ShowcaseSessions.ts";
import { ShowcaseSessionsController } from "./admin/ShowcaseSessionsController.ts";
import { ShowcaseUsers } from "./admin/ShowcaseUsers.ts";
import { ShowcaseUsersController } from "./admin/ShowcaseUsersController.ts";
import { ShowcaseController } from "./ShowcaseController.ts";
import { ShowcaseMembers } from "./ShowcaseMembers.ts";
import { ShowcaseMfaController } from "./ShowcaseMfaController.ts";

/**
 * The data half of the showcase.
 *
 * `AlephaServerLinks` is imported explicitly rather than assumed: it serves
 * `GET /api/_links` and `POST /api/_batch`, which is how the browser resolves
 * and dispatches every action on this site.
 *
 * The `admin/*` controllers impersonate the real `alepha/api/*` ones by
 * declaring `$action`s under their exact names, which is what lets the shared
 * admin components render here unmodified. `AdminRouter` itself is NOT
 * mounted: its layout is `$pageNav({ permission: "admin:ui" })`, and this site
 * has no realm to grant that. The components are rendered directly on
 * showcase pages instead, which also frames each one as a specimen rather than
 * burying it in a second navigation tree.
 */
export const UiShowcase = $module({
  name: "ui.showcase",
  imports: [AlephaServerLinks],
  services: [
    ShowcaseMembers,
    ShowcaseController,
    ShowcaseAudits,
    ShowcaseAuditsController,
    ShowcaseUsers,
    ShowcaseUsersController,
    ShowcaseJobs,
    ShowcaseJobsController,
    ShowcaseSessions,
    ShowcaseSessionsController,
    ShowcaseKeys,
    ShowcaseKeysController,
    ShowcaseFiles,
    ShowcaseFilesController,
    ShowcaseNotifications,
    ShowcaseNotificationsController,
    ShowcaseParameters,
    ShowcaseParametersController,
    ShowcaseAnalytics,
    ShowcaseAnalyticsController,
    ShowcasePayments,
    ShowcasePaymentsController,
    ShowcaseIdentitiesController,
    ShowcaseMfaController,
  ],
});
