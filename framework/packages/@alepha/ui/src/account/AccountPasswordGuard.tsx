import type { MyIdentityController } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useEffect, useState } from "react";

import { AccountPasswordDialog } from "./AccountPasswordDialog.tsx";

/**
 * Makes a signed-in user replace a temporary password before using the app.
 *
 * An admin who sets a password with "Require a new password at next sign-in"
 * marks it temporary. Mount this once in the signed-in layout: it reads the
 * mark from the user's own sign-in methods and, while it is set, shows the
 * change-password dialog with no way to dismiss it. Changing the password
 * clears the mark on the server, and the dialog goes.
 *
 * It renders nothing for a visitor, for an account without a password, and
 * when the identities cannot be read: a failed check must not lock anyone
 * out.
 *
 * ```tsx
 * <SidebarProvider>
 *   <AppSidebar />
 *   <SidebarInset>{children}</SidebarInset>
 *   <AccountPasswordGuard />
 * </SidebarProvider>
 * ```
 */
export const AccountPasswordGuard = () => {
  const { user } = useAuth();
  const api = useClient<MyIdentityController>();
  // The id of the user whose password is marked, not a bare boolean: a
  // mark read for one account must not carry over to the next sign-in.
  const [markedFor, setMarkedFor] = useState<string>();
  const userId = user?.id;
  const required = !!userId && markedFor === userId;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api
      .listMyIdentities()
      .then((identities) => {
        if (cancelled) return;
        const marked = identities.some(
          (identity) =>
            identity.provider === "credentials" &&
            identity.mustChangePassword === true,
        );
        setMarkedFor(marked ? userId : undefined);
      })
      .catch(() => {
        // Not fatal: without the list there is no mark to enforce.
      });
    return () => {
      cancelled = true;
    };
  }, [userId, api]);

  if (!required) return null;

  return (
    <AccountPasswordDialog
      open
      required
      hasPassword
      onOpenChange={() => {}}
      onDone={() => setMarkedFor(undefined)}
    />
  );
};
