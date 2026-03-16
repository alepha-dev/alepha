import { ActionButton } from "@alepha/ui";
import { IconSettings } from "@tabler/icons-react";
import { useAuth } from "alepha/react/auth";

export type HeaderAdminLinkProps = {};

export const HeaderAdminLink = (props: HeaderAdminLinkProps) => {
  const { user, can } = useAuth();

  if (!user || !can("admin:access")) {
    return null;
  }

  return (
    <ActionButton size="sm" variant="default" icon={IconSettings} href="/admin">
      Admin
    </ActionButton>
  );
};
