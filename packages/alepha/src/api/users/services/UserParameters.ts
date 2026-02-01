import { $config } from "alepha/api/parameters";
import { realmAuthSettingsAtom } from "../atoms/realmAuthSettingsAtom.ts";

/**
 * User-specific configuration service.
 *
 * This service wraps the core ConfigStore to provide realm settings management.
 * It is lazy-loaded when the `parameters` feature is enabled in the realm.
 */
export class UserParameters {
  /**
   * Realm authentication settings configuration.
   *
   * Controls user registration, login methods, verification requirements,
   * and password policies for the realm.
   */
  public readonly realmSettings = $config({
    name: "alepha.api.users.realmSettings",
    description: "Realm authentication and registration settings",
    schema: realmAuthSettingsAtom.schema,
    default: realmAuthSettingsAtom.options.default,
  });
}
