import * as React from "react";

void React;

import type { RealmConfig } from "alepha/api/users";

export interface AuthRegisterRealmHeaderProps {
  settings: RealmConfig["settings"];
  realmName: string;
}

export const AuthRegisterRealmHeader = (
  props: AuthRegisterRealmHeaderProps,
) => {
  const s = props.settings;
  if (!s.displayName && !s.description) return null;
  return (
    <div className="flex flex-col items-center gap-1">
      {s.displayName && (
        <h2 className="text-center text-lg font-semibold">{s.displayName}</h2>
      )}
      {s.description && (
        <p className="text-muted-foreground text-center text-sm">
          {s.description}
        </p>
      )}
    </div>
  );
};
