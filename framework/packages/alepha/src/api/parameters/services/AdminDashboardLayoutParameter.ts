import { $parameter } from "../primitives/$parameter.ts";
import { adminDashboardLayoutSchema } from "../schemas/adminDashboardLayoutSchema.ts";

/**
 * The admin dashboard's layout parameter, on a class of its own.
 *
 * `$parameter` is a boot primitive, and a class holding actions must stay a
 * pure controller (created on its first request, not at boot), so the
 * parameter lives here, listed by `AlephaApiParameters`, and
 * `AdminDashboardLayoutController` injects it.
 */
export class AdminDashboardLayoutParameter {
  /**
   * The stored layout. Empty `tiles` means "the code defaults", which is
   * also what a deployment that never saved one gets.
   */
  public readonly layout = $parameter({
    name: "admin.dashboard.layout",
    description: "Which admin dashboard tiles show, and in what order.",
    schema: adminDashboardLayoutSchema,
    default: { tiles: [] },
  });
}
