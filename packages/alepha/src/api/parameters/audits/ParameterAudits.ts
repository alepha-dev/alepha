import { $audit } from "alepha/api/audits";

/**
 * Runtime parameter (config) audit events.
 *
 * Holds the `parameter` audit type. Using `$audit` pulls in the audits module
 * automatically — the parameters module does not need to import it. Register
 * as a variant and log via `parameterAudits.parameter.log("rollback", …)`.
 */
export class ParameterAudits {
  public readonly parameter = $audit({
    type: "parameter",
    description:
      "Runtime parameter changes (create, rollback, activate, delete).",
    actions: ["create", "rollback", "activate", "delete"],
  });
}
