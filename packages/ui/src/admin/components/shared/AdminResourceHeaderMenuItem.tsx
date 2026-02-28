import { Menu } from "@mantine/core";
import { useRouter } from "alepha/react/router";
import type { AdminResourceAction } from "./AdminResourceHeader.tsx";

export interface AdminResourceHeaderMenuItemProps {
  /**
   * Action configuration
   */
  action: AdminResourceAction;
}

const AdminResourceHeaderMenuItem = (
  props: AdminResourceHeaderMenuItemProps,
) => {
  const { action } = props;
  const router = useRouter();

  const menuItemProps: Record<string, unknown> = {};
  if (action.href) {
    Object.assign(menuItemProps, router.anchor(action.href));
  } else if (action.onClick) {
    menuItemProps.onClick = action.onClick;
  }

  return (
    <Menu.Item
      leftSection={action.icon ? <action.icon size={16} /> : undefined}
      color={action.color}
      disabled={action.disabled}
      {...menuItemProps}
    >
      {action.label}
    </Menu.Item>
  );
};

export default AdminResourceHeaderMenuItem;
