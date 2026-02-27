import {
  ActionButton,
  type ActionMenuConfig,
  type ActionMenuItem,
  type ActionProps,
  ui,
} from "@alepha/ui";
import { Avatar } from "@mantine/core";
import {
  IconLogin2,
  IconLogout,
  IconSettings,
  IconUser,
} from "@tabler/icons-react";
import type { AdminUserController } from "alepha/api/users";
import { useClient, useInject } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { ReactPageProvider, useRouter } from "alepha/react/router";
import type { ReactNode } from "react";
import type { AuthRouter } from "../../AuthRouter.ts";

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
   * Custom label for the login button when user is not authenticated
   */
  loginLabel?: string;

  /**
   * Menu configuration overrides
   */
  menuConfig?: Partial<Omit<ActionMenuConfig, "items">>;

  /**
   * Custom icon to use instead of user avatar (default: IconUser)
   */
  icon?: ReactNode;

  /**
   * If true, the profile link will not be shown in the menu even if a userProfile page exists and the user is authenticated.
   */
  skipProfile?: boolean;
}

const UserButton = (props: UserButtonProps) => {
  const {
    menuItems = [],
    logoutLabel = "Sign out",
    loginLabel,
    menuConfig,
    icon,
    skipProfile = false,
    children,
    ...buttonProps
  } = props;

  buttonProps.variant ??= "default";

  const adminUserCtrl = useClient<AdminUserController>();
  const pages = useInject(ReactPageProvider);

  const auth = useAuth<{
    username?: string;
    email?: string;
    picture?: string;
  }>();

  const isConnected = !!auth.user;
  const isAdmin = isConnected && adminUserCtrl.findUsers.can();
  const userPage = pages.getPages().find((it) => it.name === "userProfile");
  const adminPage = pages.getPages().find((it) => it.name === "adminLayout");
  const authRouter = useRouter<AuthRouter>();

  if (!auth.user) {
    return (
      <ActionButton
        {...buttonProps}
        icon={icon === null ? undefined : (icon ?? IconLogin2)}
        href={authRouter.path("login")}
      >
        {loginLabel ?? children}
      </ActionButton>
    );
  }

  const items: ActionMenuItem[] = [];

  // Add user info label if available
  if (auth.user.email && auth.user.username) {
    items.push({
      type: "label",
      label: auth.user.email,
    });
  }

  // Add profile page link if available
  if (userPage && isConnected && !skipProfile) {
    items.push({
      label: "Profile",
      icon: <IconUser size={ui.sizes.icon.sm} />,
      href: authRouter.path("userProfile"),
    });
  }

  // Add admin page link if available and user is admin
  if (adminPage && isAdmin) {
    items.push({
      label: "Admin",
      icon: <IconSettings size={ui.sizes.icon.sm} />,
      href: authRouter.path("adminLayout"),
    });
  }

  // Add custom menu items
  items.push(...menuItems);

  // Add divider before logout if needed
  if (items.length > 0) {
    items.push({ type: "divider" });
  }

  // Add logout item
  items.push({
    label: logoutLabel,
    icon: <IconLogout size={ui.sizes.icon.sm} />,
    color: "red",
    onClick: () => auth.logout(),
  });

  // Use leftSection for Avatar (JSX element), icon prop for component types
  const hasAvatar = icon === undefined && auth.user.picture;

  return (
    <ActionButton
      {...buttonProps}
      icon={
        hasAvatar ? undefined : icon === null ? undefined : (icon ?? IconUser)
      }
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
        menuProps: {
          withArrow: true,
          arrowSize: 12,
        },

        position: "bottom",
        width: 200,
        ...menuConfig,
        items,
      }}
    >
      {children}
    </ActionButton>
  );
};

export default UserButton;
