import * as React from "react";

void React;

import { useAuth } from "alepha/react/auth";

export interface ButtonUserEmailProps {
  /**
   * Optional fallback when the user has no email. Defaults to username, then id.
   */
  fallback?: string;
}

export const ButtonUserEmail = (props: ButtonUserEmailProps) => {
  const auth = useAuth();
  const user = auth.user as
    | { email?: string; username?: string; id?: string }
    | undefined;
  if (!user) return null;
  const text = user.email ?? user.username ?? props.fallback ?? user.id ?? null;
  if (!text) return null;
  return (
    <div className="text-muted-foreground truncate px-2 py-1.5 text-xs">
      {text}
    </div>
  );
};
