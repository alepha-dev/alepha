import { $permission } from "alepha/security";

/**
 * Who may do what with live updates. Enforced by the server on every action;
 * the admin hides what a user cannot do, which is a courtesy, not the guard.
 *
 * - `ota:read`: see apps, channels, bundles and device telemetry;
 * - `ota:manage`: change them: channels, rollout, rollback, the kill switch,
 *   device overrides;
 * - `ota:release`: publish a bundle. An API key needs it and must also be
 *   listed on the app it publishes to.
 */
export class OtaPermissions {
  public readonly read = $permission({
    group: "ota",
    name: "read",
    description: "See live update apps, channels, bundles and devices",
  });

  public readonly manage = $permission({
    group: "ota",
    name: "manage",
    description:
      "Change live update channels, rollout, rollback, kill switch and device overrides",
  });

  public readonly release = $permission({
    group: "ota",
    name: "release",
    description: "Publish a live update bundle",
  });
}
