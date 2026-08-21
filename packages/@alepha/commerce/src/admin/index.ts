import { $module } from "alepha";

import { AlephaCommerce } from "../index.ts";
import { AdminOrderController } from "./controllers/AdminOrderController.ts";
import { AdminProductController } from "./controllers/AdminProductController.ts";

export * from "./controllers/AdminOrderController.ts";
export * from "./controllers/AdminProductController.ts";

/**
 * Back-office endpoints for the catalog and orders.
 *
 * The React pages that consume them live under
 * `@alepha/commerce/admin/components/*` and are **not** part of this module —
 * importing it from a headless API app must not pull React in.
 *
 * ### Why the pages are here and not in `@alepha/ui/admin`
 *
 * `@alepha/ui` is a design system. Putting commerce screens in it would make the
 * design system depend on this domain, which is backwards. The existing
 * `admin-payments.tsx` lives there because `alepha/api/payments` is part of the
 * framework core; reproducing that from a satellite package would invert the
 * arrow. So the dependency runs `@alepha/commerce/admin` → `@alepha/ui`, and
 * never back.
 *
 * Permissions used: `admin:commerce:read`, `admin:commerce:write`,
 * `admin:commerce:refund` — refunding is separated because moving money back is
 * not the same trust level as editing a product name.
 *
 * @module alepha.commerce.admin
 */
export const AlephaCommerceAdmin = $module({
  name: "alepha.commerce.admin",
  imports: [AlephaCommerce],
  services: [AdminProductController, AdminOrderController],
});
