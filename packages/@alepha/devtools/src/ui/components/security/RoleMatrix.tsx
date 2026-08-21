import { Fragment, useMemo } from "react";

import type { DevActionMetadata } from "../../../schemas/DevActionMetadata.ts";
import type { DevPermissionMetadata } from "../../../schemas/DevPermissionMetadata.ts";
import type { DevRoleMetadata } from "../../../schemas/DevRoleMetadata.ts";
import { requiredPermissions } from "./guardOf.ts";
import { RoleColumnHead } from "./RoleColumnHead.tsx";

export interface RoleMatrixProps {
  roles: DevRoleMetadata[];
  permissions: DevPermissionMetadata[];
  actions: DevActionMetadata[];
}

/**
 * Permissions × roles, grouped by permission group.
 *
 * A cell says three different things, and collapsing them to a single tick is
 * what makes over-granting invisible: a plain tick is a permission the role was
 * handed by name, a green tick is one it only reaches because a wildcard swept
 * it in, and a dash is no access. The second case is the interesting one —
 * nobody typed it, so nobody reviewed it.
 */
export const RoleMatrix = (props: RoleMatrixProps) => {
  const roles = props.roles;

  const groups = useMemo(() => {
    const byGroup = new Map<string, DevPermissionMetadata[]>();
    for (const permission of props.permissions) {
      const key = permission.group ?? "(ungrouped)";
      const list = byGroup.get(key);
      if (list) list.push(permission);
      else byGroup.set(key, [permission]);
    }
    return [...byGroup.entries()]
      .map(([name, items]) => ({
        name,
        items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [props.permissions]);

  const lookup = useMemo(
    () =>
      roles.map((role) => ({
        role,
        effective: new Set(role.effective),
        viaWildcard: new Set(role.viaWildcard),
      })),
    [roles],
  );

  /**
   * How many endpoints name each permission. A permission nothing requires is
   * either dead or a guard someone forgot to attach — both worth seeing next
   * to who holds it.
   */
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const action of props.actions) {
      for (const permission of requiredPermissions(action)) {
        counts.set(permission, (counts.get(permission) ?? 0) + 1);
      }
    }
    return counts;
  }, [props.actions]);

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="dt-table dt-matrix">
        <thead>
          <tr>
            <th>Permission</th>
            {roles.map((role) => (
              <RoleColumnHead key={`${role.realm}:${role.name}`} role={role} />
            ))}
            <th style={{ width: 90, textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.name}>
              <tr className="dt-matrix-group">
                <td colSpan={roles.length + 2}>
                  {group.name}
                  <span className="dt-matrix-group-count">
                    {group.items.length}
                  </span>
                </td>
              </tr>
              {group.items.map((permission) => {
                const used = usage.get(permission.id) ?? 0;
                return (
                  <tr key={permission.id}>
                    <td className="dt-mono" title={permission.description}>
                      {permission.id}
                    </td>
                    {lookup.map((entry) => {
                      const has = entry.effective.has(permission.id);
                      const wild = entry.viaWildcard.has(permission.id);
                      return (
                        <td
                          key={`${entry.role.realm}:${entry.role.name}`}
                          style={{ textAlign: "center" }}
                          title={
                            !has
                              ? "no access"
                              : wild
                                ? "granted by a wildcard, not named explicitly"
                                : "granted explicitly"
                          }
                        >
                          {has ? (
                            <span
                              style={{
                                color: wild ? "var(--dt-get)" : "var(--dt-fg)",
                              }}
                            >
                              ✓
                            </span>
                          ) : (
                            <span style={{ color: "var(--dt-fg-faint)" }}>
                              —
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td
                      style={{
                        textAlign: "right",
                        color: used ? "var(--dt-fg-dim)" : "var(--dt-fg-faint)",
                      }}
                      title={
                        used
                          ? `${used} action(s) require this permission`
                          : "No action requires this permission"
                      }
                    >
                      {used === 1 ? "1 action" : `${used} actions`}
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};
