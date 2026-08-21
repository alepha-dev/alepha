import { Fragment, useMemo } from "react";

import type { DevActionMetadata } from "../../../schemas/DevActionMetadata.ts";
import type { DevRoleMetadata } from "../../../schemas/DevRoleMetadata.ts";
import { methodColor, shortMethod } from "../shared/methodColor.ts";
import { type ActionGuard, guardOf } from "./guardOf.ts";
import { RoleColumnHead } from "./RoleColumnHead.tsx";

export interface ActionMatrixProps {
  actions: DevActionMetadata[];
  roles: DevRoleMetadata[];
}

interface Row {
  action: DevActionMetadata;
  guard: ActionGuard;
}

/**
 * Which roles can reach which endpoint.
 *
 * The permission matrix answers "what does this role hold"; this one answers
 * the question a reviewer actually asks — "who can call this". They differ
 * whenever an action carries no `$secure` guard at all, which shows here as a
 * row every role can reach, and nowhere in the permission matrix.
 */
export const ActionMatrix = (props: ActionMatrixProps) => {
  const roles = props.roles;

  /**
   * Grouped by declaring controller, because that is the unit a developer
   * reviews: an endpoint left unguarded is nearly always one someone forgot
   * while writing the rest of its controller, and a flat alphabetical list
   * scatters those siblings across the page.
   */
  const groups = useMemo(() => {
    const byGroup = new Map<string, Row[]>();
    for (const action of props.actions) {
      const row: Row = { action, guard: guardOf(action) };
      const list = byGroup.get(action.group);
      if (list) list.push(row);
      else byGroup.set(action.group, [row]);
    }
    return [...byGroup.entries()]
      .map(([name, rows]) => ({
        name,
        rows: rows.sort((a, b) =>
          a.action.fullPath.localeCompare(b.action.fullPath),
        ),
        // Groups holding an unguarded endpoint float to the top — that is what
        // the reader came for.
        unguarded: rows.filter((r) => !r.guard.guarded).length,
      }))
      .sort(
        (a, b) => b.unguarded - a.unguarded || a.name.localeCompare(b.name),
      );
  }, [props.actions]);

  /**
   * A role reaches an action when it holds every required permission *and*
   * matches the role list if one is given. `$secure` requires all permissions,
   * not any — matching that here keeps the grid honest.
   */
  const canReach = (role: DevRoleMetadata, row: Row): boolean => {
    if (!row.guard.guarded) return true;
    if (row.guard.roles.length && !row.guard.roles.includes(role.name)) {
      return false;
    }
    const effective = new Set(role.effective);
    return row.guard.permissions.every((p) => effective.has(p));
  };

  const describe = (guard: ActionGuard) => {
    if (!guard.guarded) return null;
    if (guard.permissions.length || guard.roles.length) {
      return [
        ...guard.permissions,
        ...guard.roles.map((r) => `role:${r}`),
      ].join(", ");
    }
    return "$secure(), any authenticated";
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="dt-table dt-matrix">
        <thead>
          <tr>
            <th>Action</th>
            {roles.map((role) => (
              <RoleColumnHead key={`${role.realm}:${role.name}`} role={role} />
            ))}
            <th style={{ width: 200, textAlign: "right" }}>Guard</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.name}>
              <tr className="dt-matrix-group">
                <td colSpan={roles.length + 2}>
                  {group.name}
                  <span className="dt-matrix-group-count">
                    {group.rows.length}
                  </span>
                </td>
              </tr>
              {/*
               * Keyed on the action name, not method+path: two actions can
               * legitimately share both, and a duplicate key silently drops
               * one of them.
               */}
              {group.rows.map((row) => (
                <tr
                  key={row.action.name}
                  data-unguarded={!row.guard.guarded || undefined}
                >
                  <td className="dt-mono">
                    <span
                      className="dt-method"
                      style={{ color: methodColor(row.action.method) }}
                    >
                      {shortMethod(row.action.method)}
                    </span>{" "}
                    {row.action.fullPath}
                  </td>
                  {roles.map((role) => {
                    const reach = canReach(role, row);
                    return (
                      <td
                        key={`${role.realm}:${role.name}`}
                        style={{ textAlign: "center" }}
                        title={
                          row.guard.guarded
                            ? reach
                              ? "holds every required permission"
                              : "missing at least one required permission"
                            : "unguarded — reachable by anyone"
                        }
                      >
                        <span
                          style={{
                            color: !row.guard.guarded
                              ? "var(--dt-danger)"
                              : reach
                                ? "var(--dt-fg)"
                                : "var(--dt-fg-faint)",
                          }}
                        >
                          {reach ? "✓" : "—"}
                        </span>
                      </td>
                    );
                  })}
                  <td
                    className="dt-mono"
                    style={{
                      textAlign: "right",
                      fontSize: 10,
                      maxWidth: 200,
                      color: row.guard.guarded
                        ? "var(--dt-fg-dim)"
                        : "var(--dt-danger)",
                    }}
                    title={describe(row.guard) ?? "No $secure middleware"}
                  >
                    {describe(row.guard) ?? "unprotected"}
                    {row.guard.hasCallback && (
                      <span className="dt-nav-count" style={{ marginLeft: 6 }}>
                        + guard()
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};
