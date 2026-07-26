import * as React from "react";

void React;

import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alepha/ui/components/ui/popover";
import type { UserEntity } from "alepha/api/users";
import { useEffect, useState } from "react";

export interface RoleMeta {
  name: string;
  default?: boolean;
  description?: string;
}

export interface AdminUsersRolesPickerProps {
  user: UserEntity;
  /**
   * Role metadata from the realm. Empty while the fetch is in flight, or
   * permanently if it failed — the picker degrades rather than blocking.
   */
  availableRoles: ReadonlyArray<RoleMeta>;
  onToggle: (role: string, checked: boolean) => Promise<void>;
  rolesLabel: string;
  noRolesLabel: string;
}

/**
 * Inline roles editor for a row of the users table.
 */
export const AdminUsersRolesPicker = (props: AdminUsersRolesPickerProps) => {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  // The users table no longer hard-reloads after a role toggle, so the row's
  // `user.roles` would stay stale. Track an optimistic override locally so the
  // label and checkboxes reflect the change immediately; re-sync whenever the
  // row's roles change (e.g. a table refresh from another action).
  const [optimisticRoles, setOptimisticRoles] = useState<string[] | null>(null);
  useEffect(() => {
    setOptimisticRoles(null);
  }, [props.user.roles]);

  const userRoles = optimisticRoles ?? props.user.roles ?? [];
  const label =
    userRoles.length > 0 ? (
      userRoles.join(", ")
    ) : (
      <span className="text-muted-foreground">{props.noRolesLabel}</span>
    );

  // If the metadata fetch hasn't landed yet, union the user's roles
  // with a sane fallback so the popover still renders rows for everything
  // the user currently has. Default state isn't known until metadata
  // arrives — only the disable rule degrades.
  const rows: ReadonlyArray<RoleMeta> =
    props.availableRoles.length > 0
      ? props.availableRoles
      : userRoles.map((name) => ({ name }));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="text-left text-sm hover:underline focus:outline-none focus-visible:underline"
          />
        }
      >
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          {props.rolesLabel}
        </div>
        <div className="flex flex-col">
          {rows.map((role) => {
            const checked = userRoles.includes(role.name);
            const disabled = role.default === true || pending === role.name;
            return (
              <label
                key={role.name}
                className={
                  disabled
                    ? "flex cursor-not-allowed items-center gap-2 rounded-sm px-2 py-1.5 text-sm opacity-60"
                    : "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                }
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={async (next) => {
                    if (disabled) return;
                    setPending(role.name);
                    try {
                      await props.onToggle(role.name, Boolean(next));
                      // Reflect the change locally — the table no longer
                      // reloads the row after a role toggle.
                      setOptimisticRoles(
                        next
                          ? Array.from(new Set([...userRoles, role.name]))
                          : userRoles.filter((r) => r !== role.name),
                      );
                    } finally {
                      setPending(null);
                    }
                  }}
                />
                <span className="flex-1">{role.name}</span>
                {role.default && (
                  <span className="text-[10px] uppercase text-muted-foreground">
                    default
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};
