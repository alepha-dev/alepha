import { $inject, z } from "alepha";
import { DeviceCodeService } from "alepha/api/oauth";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

/**
 * Records a human's decision on a waiting terminal.
 *
 * The endpoint that makes the device grant safe. A device code proves nothing
 * on its own — it is this call, made from an authenticated session, that decides
 * whose identity the terminal will borrow. So it is `$secure`d like every other
 * admin action, and the user id comes from the session rather than from
 * anything the caller sent.
 */
export class DeviceController {
  protected readonly devices = $inject(DeviceCodeService);

  /**
   * Tells the approval page what it is about to approve.
   *
   * Two jobs, both needed before anything is rendered. It is admin-guarded, so
   * an unauthenticated visitor is bounced to sign-in during navigation rather
   * than after filling the form — losing the code they came in with. And it
   * says whether the code is real, so nobody approves a typo and then hunts for
   * why the terminal is still waiting.
   *
   * Enumeration is not a concern here: only an admin can reach it, and an admin
   * can approve any code anyway.
   */
  lookup = $action({
    method: "GET",
    path: "/device/lookup",
    use: [$secure({ roles: ["admin"] })],
    description: "Check whether a device code is waiting for a decision",
    schema: {
      query: z.object({ userCode: z.text({ maxLength: 32, default: "" }) }),
      response: z.object({
        status: z.enum(["pending", "approved", "denied", "unknown"]),
      }),
    },
    handler: async ({ query }) => {
      if (!query.userCode) {
        return { status: "unknown" as const };
      }
      const record = await this.devices.byUserCode(query.userCode);
      return { status: record?.status ?? ("unknown" as const) };
    },
  });

  decide = $action({
    method: "POST",
    path: "/device/decide",
    use: [$secure({ roles: ["admin"] })],
    description: "Approve or refuse a terminal waiting to log in",
    schema: {
      body: z.object({
        userCode: z.text({ maxLength: 32 }),
        decision: z.enum(["approve", "deny"]),
      }),
      response: z.object({ status: z.text() }),
    },
    handler: async ({ body, user }) => {
      const record = await this.devices.decide(
        body.userCode,
        body.decision,
        // From the session, never from the body: letting a caller name the user
        // would turn this into an impersonation endpoint.
        user.id,
      );
      return { status: record.status };
    },
  });
}
