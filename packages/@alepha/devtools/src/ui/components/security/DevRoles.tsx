import { z } from "alepha";
import { useQueryParams } from "alepha/react/router";
import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";
import { useMetadata } from "../../hooks/useMetadata.ts";
import { DevEmpty } from "../shared/DevEmpty.tsx";
import { DevError } from "../shared/DevError.tsx";
import { ActionMatrix } from "./ActionMatrix.tsx";
import { RoleMatrix } from "./RoleMatrix.tsx";

const querySchema = z.object({
  tab: z.enum(["permissions", "actions"]).optional(),
});

export const DevRoles = () => {
  const meta = useMetadata();
  const [params, setParams] = useQueryParams(querySchema, {
    format: "querystring",
  });

  const roles = meta.data?.roles ?? [];
  const permissions = meta.data?.permissions ?? [];
  const actions = meta.data?.actions ?? [];
  const tab = params.tab ?? "permissions";

  /**
   * Two counts worth surfacing before anything else, because both are silent
   * failures: an endpoint nobody guarded, and a permission no one deliberately
   * granted. Neither shows up as an error anywhere else in the app.
   */
  const audit = useMemo(() => {
    const unguarded = actions.filter(
      (action) => !action.middlewares?.some((m) => m.name === "$secure"),
    ).length;
    const wildcardOnly = new Set(roles.flatMap((role) => role.viaWildcard))
      .size;
    return { unguarded, wildcardOnly };
  }, [actions, roles]);

  if (meta.error) {
    return <DevError what="roles" message={meta.error} onRetry={meta.reload} />;
  }

  if (!meta.loading && roles.length === 0) {
    return (
      <DevEmpty
        title="No roles declared"
        hint="Use $role and $permission to declare authorization"
      />
    );
  }

  return (
    <div style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
      <div className="dt-toolbar">
        <span className="dt-seg">
          <button
            type="button"
            className="dt-seg-item"
            style={{ textTransform: "none", letterSpacing: 0, fontSize: 11 }}
            data-on={tab === "permissions" || undefined}
            onClick={() => setParams({ tab: "permissions" })}
          >
            Permissions × Roles
          </button>
          <button
            type="button"
            className="dt-seg-item"
            style={{ textTransform: "none", letterSpacing: 0, fontSize: 11 }}
            data-on={tab === "actions" || undefined}
            onClick={() => setParams({ tab: "actions" })}
          >
            Actions × Roles
          </button>
        </span>

        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {audit.unguarded > 0 && (
            <span className="dt-chip" data-tone="danger">
              <AlertTriangle size={10} style={{ marginRight: 5 }} />
              {audit.unguarded} action{audit.unguarded === 1 ? "" : "s"} carry
              no guard
            </span>
          )}
          {audit.wildcardOnly > 0 && (
            <span className="dt-chip" data-tone="warn">
              {audit.wildcardOnly} reachable only via the * wildcard
            </span>
          )}
        </span>
      </div>

      {tab === "permissions" ? (
        <RoleMatrix roles={roles} permissions={permissions} actions={actions} />
      ) : (
        <ActionMatrix roles={roles} actions={actions} />
      )}

      <div
        style={{
          display: "flex",
          gap: 18,
          padding: "10px 14px",
          fontSize: 10,
          color: "var(--dt-fg-faint)",
        }}
      >
        <span>
          <span style={{ color: "var(--dt-fg)" }}>✓</span> granted explicitly
        </span>
        <span>
          <span style={{ color: "var(--dt-get)" }}>✓</span> granted by the{" "}
          <span style={{ color: "var(--dt-danger)" }}>*</span> wildcard
        </span>
        <span>— denied</span>
        <span>
          Derived from $realm roles and the $secure({" "}
          <span className="dt-mono">permissions</span> ) guard on each action.
          No runtime data.
        </span>
      </div>
    </div>
  );
};

export default DevRoles;
