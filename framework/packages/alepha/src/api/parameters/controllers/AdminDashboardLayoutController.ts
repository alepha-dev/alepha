import { $inject, Alepha } from "alepha";
import { DbConflictError } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, ConflictError } from "alepha/server";

import { ParameterAudits } from "../audits/ParameterAudits.ts";
import { adminDashboardLayoutResponseSchema } from "../schemas/adminDashboardLayoutResponseSchema.ts";
import {
  type AdminDashboardLayout,
  adminDashboardLayoutSchema,
} from "../schemas/adminDashboardLayoutSchema.ts";
import { setAdminDashboardLayoutBodySchema } from "../schemas/setAdminDashboardLayoutBodySchema.ts";
import { AdminDashboardLayoutParameter } from "../services/AdminDashboardLayoutParameter.ts";
import { ParameterProvider } from "../services/ParameterProvider.ts";

/**
 * The server home of the admin dashboard's layout: which tiles show, in what
 * order, for every admin of the deployment.
 *
 * ### Why it lives here, not in `@alepha/ui`
 *
 * The layout is a `$parameter`, so it is versioned, with history and author,
 * on the Parameters page like any other setting. `$parameter` is server-only
 * and `@alepha/ui` has no server code, so the declaration and its two
 * actions sit in the parameters module, and the dashboard reaches them by a
 * type-only import of this class, like every other admin API.
 *
 * ### Why two actions of its own
 *
 * Reading through `AdminParameterController` needs `admin:parameter:read`,
 * so an admin without it would silently see the defaults, and "one layout for
 * every admin" would be false. The read is gated on `admin:ui`, the
 * permission that opens `/admin` at all; the write on
 * `admin:parameter:create`, the one that writes any parameter.
 *
 * Without this module the dashboard falls back to the code defaults and
 * shows no Customize button.
 */
export class AdminDashboardLayoutController {
  protected readonly group = "admin:dashboard";
  protected readonly provider = $inject(ParameterProvider);
  protected readonly alepha = $inject(Alepha);

  /**
   * The parameter, declared on a class of its own so this one stays a pure
   * controller.
   */
  protected readonly parameter = $inject(AdminDashboardLayoutParameter);

  protected get layout() {
    return this.parameter.layout;
  }

  /**
   * The layout and its version, for any admin.
   */
  public readonly getAdminDashboardLayout = $action({
    method: "GET",
    path: "/dashboard/layout",
    group: this.group,
    use: [$secure({ permissions: ["admin:ui"] })],
    description: "Read the admin dashboard layout and its version",
    schema: {
      response: adminDashboardLayoutResponseSchema,
    },
    handler: async () => {
      // Read from the database, not the cached value: the version is read
      // there, and a layout older than its version would let a save
      // overwrite a change its author never saw.
      const [{ current }, version] = await Promise.all([
        this.provider.loadCurrentAndNext(this.layout.name),
        this.provider.getLatestVersion(this.layout.name),
      ]);
      const stored = adminDashboardLayoutSchema.safeParse(current?.content);
      const layout: AdminDashboardLayout = stored.success
        ? stored.data
        : { tiles: [] };
      return { layout, version };
    },
  });

  /**
   * Save the layout, as a new version of its parameter. `expectedVersion` is
   * the version the edit started from: another admin's save in between is a
   * 409, never a silent overwrite.
   */
  public readonly setAdminDashboardLayout = $action({
    method: "PUT",
    path: "/dashboard/layout",
    group: this.group,
    use: [$secure({ permissions: ["admin:parameter:create"] })],
    description: "Save the admin dashboard layout, with a version check",
    schema: {
      body: setAdminDashboardLayoutBodySchema,
      response: adminDashboardLayoutResponseSchema,
    },
    handler: async ({ body, user }) => {
      try {
        const saved = await this.provider.save(
          this.layout.name,
          body.layout,
          "",
          {
            expectedVersion: body.expectedVersion,
            changeDescription: "Admin dashboard layout",
            creatorId: user?.id,
            creatorName: user?.username ?? user?.email,
          },
        );
        await this.audit(saved.version);
        return {
          layout: saved.content as AdminDashboardLayout,
          version: saved.version,
        };
      } catch (error) {
        if (error instanceof DbConflictError) {
          throw new ConflictError(
            "The dashboard layout was changed by another admin since it was loaded",
          );
        }
        throw error;
      }
    },
  });

  /**
   * Best-effort, like every other parameter write: a missing or failing
   * audit module never fails the save.
   */
  protected async audit(version: number): Promise<void> {
    if (!this.alepha.has(ParameterAudits)) {
      return;
    }
    try {
      await this.alepha.inject(ParameterAudits).parameter.log("create", {
        resourceType: "parameter",
        resourceId: this.layout.name,
        metadata: { version },
      });
    } catch {
      // Auditing is best-effort.
    }
  }
}
