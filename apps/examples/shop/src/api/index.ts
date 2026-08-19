import { ProductKindRegistry } from "@alepha/commerce";
import { AlephaCommerceAdmin } from "@alepha/commerce/admin";
import { AlephaCommerceInvoicing } from "@alepha/commerce/invoicing";
import { AlephaCommerceNotifications } from "@alepha/commerce/notifications";
import { AlephaCommerceRecovery } from "@alepha/commerce/recovery";
import { AlephaCommerceSettlement } from "@alepha/commerce/settlement";
import { AlephaCommerceShipping } from "@alepha/commerce/shipping";
import { $module } from "alepha";
import { AlephaApiAudits } from "alepha/api/audits";
import { AlephaApiFiles, FileAccessProvider } from "alepha/api/files";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaApiNotifications } from "alepha/api/notifications";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaApiWorkflows } from "alepha/api/workflows";
import { AlephaOrm } from "alepha/orm";
import { EngravedKindHandler } from "./EngravedKindHandler.ts";
import { FactureController } from "./FactureController.ts";
import { ShopDrawings } from "./ShopDrawings.ts";
import { ShopFileAccess } from "./ShopFileAccess.ts";
import { ShopMedia } from "./ShopMedia.ts";
import { ShopRealm } from "./ShopRealm.ts";
import { ShopSeed } from "./ShopSeed.ts";
import { WorkshopQueue } from "./WorkshopQueue.ts";

/**
 * Atelier Aurore — the server half.
 *
 * The import list is the feature list. Everything commerce-related comes from
 * `@alepha/commerce`; what this application adds is one product kind of its own
 * (`engraved`, which queues a workshop task), the catalogue's drawings, and a
 * realm. That ratio is the point of the exercise.
 *
 * @module shop.api
 */
export const ShopApi = $module({
  name: "shop.api",
  imports: [
    AlephaOrm,
    AlephaApiUsers,
    // Product imagery: file rows, real storage, public URLs at /public/files/:id.
    AlephaApiFiles,
    // Shipping, invoicing and notifications each pull the checkout in themselves.
    AlephaCommerceShipping,
    AlephaCommerceInvoicing,
    AlephaCommerceNotifications,
    // The durable paid-path: invoice + confirmation as a $workflow. Invoicing
    // and notifications do nothing on the paid transition without it.
    AlephaCommerceSettlement,
    // Abandoned-cart reminders, riding the same workflow engine.
    AlephaCommerceRecovery,
    AlephaCommerceAdmin,
    /*
     * Back-office modules, registered for their admin surface rather than for
     * anything the storefront calls.
     *
     * Each admin page hides itself when the action behind it is absent from
     * `/api/_links`, so before this the shop's sidebar simply had no Jobs,
     * Notifications, Audit log or Workflows entry — the pages have always
     * existed in `@alepha/ui`, they had no backend here to read. Registering
     * the modules is the whole of "adding" those screens.
     */
    AlephaApiAudits,
    AlephaApiJobs,
    AlephaApiNotifications,
    AlephaApiWorkflows,
  ],
  /*
   * `FactureController` is listed here, and forgetting to list it is why the
   * invoice link on the confirmation page answered 404 from the day it was
   * written. The file moved out of the web module (a `$route` there dragged
   * `invoicing` → `checkout` → `$job` into the browser bundle) and was never
   * added back on this side, so the class existed, compiled, typechecked, and was
   * instantiated by nobody. Nothing catches that but a request.
   */
  services: [
    ShopRealm,
    ShopMedia,
    ShopDrawings,
    WorkshopQueue,
    ShopSeed,
    FactureController,
  ],
  variants: [EngravedKindHandler, ShopFileAccess],
  register: (alepha) => {
    alepha.inject(ProductKindRegistry).add(alepha.inject(EngravedKindHandler));
    // Opens the `pieces` bucket to anonymous visitors. Without it the framework
    // answers 404 for every drawing, which is its correct default.
    alepha.with({ provide: FileAccessProvider, use: ShopFileAccess });
  },
});
