import { useAuth } from "@alepha/react/auth";
import {
  ActionButton,
  type ActionMenuConfig,
  type ActionMenuItem,
  type ActionProps,
  ui,
} from "@alepha/ui";
import { Avatar } from "@mantine/core";
import { IconLogout, IconUser } from "@tabler/icons-react";
import type { ReactNode } from "react";

export interface UserButtonProps
  extends Omit<ActionProps, "menu" | "icon" | "onClick"> {
  /**
   * Additional menu items to display before the logout option
   */
  menuItems?: ActionMenuItem[];

  /**
   * Custom logout label (default: "Sign out")
   */
  logoutLabel?: string;

  /**
   * Menu configuration overrides
   */
  menuConfig?: Partial<Omit<ActionMenuConfig, "items">>;

  /**
   * Whether to show a divider before logout (default: true when menuItems provided)
   */
  showLogoutDivider?: boolean;

  /**
   * Custom icon to use instead of user avatar (default: IconUser)
   */
  icon?: ReactNode;
}

const UserButton = (props: UserButtonProps) => {
  const {
    menuItems = [],
    logoutLabel = "Sign out",
    menuConfig,
    showLogoutDivider = menuItems.length > 0,
    icon,
    children,
    ...buttonProps
  } = props;

  const auth = useAuth<{
    username?: string;
    email?: string;
    picture?: string;
  }>();

  if (!auth.user) {
    return null;
  }

  const userLabel = auth.user.username || auth.user.email;

  const items: ActionMenuItem[] = [];

  // Add user info label if available
  if (auth.user.email && auth.user.username) {
    items.push({
      type: "label",
      label: auth.user.email,
    });
  }

  // Add custom menu items
  items.push(...menuItems);

  // Add divider before logout if needed
  if (showLogoutDivider && items.length > 0) {
    items.push({ type: "divider" });
  }

  // Add logout item
  items.push({
    label: logoutLabel,
    icon: <IconLogout size={ui.sizes.icon.md} />,
    color: "red",
    onClick: () => auth.logout(),
  });

  // Use leftSection for Avatar (JSX element), icon prop for component types
  const hasAvatar = !icon && auth.user.picture;

  return (
    <ActionButton
      {...buttonProps}
      icon={hasAvatar ? undefined : (icon ?? IconUser)}
      leftSection={
        hasAvatar ? (
          <Avatar
            src={`/api/files/${auth.user.picture}`}
            size={24}
            radius="xl"
          />
        ) : undefined
      }
      menu={{
        position: "bottom-end",
        width: 200,
        ...menuConfig,
        items,
      }}
    >
      {children ?? userLabel}
    </ActionButton>
  );
};

export default UserButton;
