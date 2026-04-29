import {
  AlephaMantineProvider,
  DashboardShell,
  type DashboardShellProps,
} from "@alepha/mantine";
import { IconArrowLeft } from "@tabler/icons-react";

export interface AdminLayoutProps {
  adminShellProps?: DashboardShellProps;
}

const AdminLayout = (props: AdminLayoutProps) => {
  const providedItems = props.adminShellProps?.sidebarProps?.items ?? [];
  const items = [
    {
      position: "top" as const,
      label: "Back",
      icon: IconArrowLeft,
      href: "/",
    },
    ...providedItems,
    {
      position: "bottom" as const,
      type: "toggle" as const,
    },
  ];

  return (
    <AlephaMantineProvider>
      <DashboardShell
        appBarProps={{
          items: [
            {
              position: "right",
              type: "dark",
            },
          ],
        }}
        {...props.adminShellProps}
        sidebarProps={{
          ...props.adminShellProps?.sidebarProps,
          items,
        }}
      />
    </AlephaMantineProvider>
  );
};

export default AdminLayout;
