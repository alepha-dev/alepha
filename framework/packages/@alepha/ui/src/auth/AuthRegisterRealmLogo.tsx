import * as React from "react";

void React;

import type { RealmConfig } from "alepha/api/users";

export interface AuthRegisterRealmLogoProps {
  settings: RealmConfig["settings"];
  realmName: string;
}

export const AuthRegisterRealmLogo = (props: AuthRegisterRealmLogoProps) => {
  if (!props.settings.logoUrl) return null;
  return (
    <img
      src={props.settings.logoUrl}
      alt={props.settings.displayName || props.realmName}
      className="bg-muted size-16 rounded-xl border object-cover shadow-sm"
    />
  );
};
