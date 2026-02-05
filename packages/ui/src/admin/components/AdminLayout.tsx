import {
  ActionButton,
  AlephaMantineProvider,
  DashboardShell,
  type DashboardShellProps,
} from "@alepha/ui";
import { UserButton } from "@alepha/ui/auth";
import { Flex } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";

export interface AdminLayoutProps {
  adminShellProps?: DashboardShellProps;
}

const AdminLayout = (props: AdminLayoutProps) => {
  return (
    <AlephaMantineProvider>
      <DashboardShell
        footer={<Flex h={24} />}
        appBarProps={{
          items: [
            {
              element: (
                <ActionButton
                  variant={"subtle"}
                  icon={IconArrowLeft}
                  href={"/"}
                />
              ),
              position: "left",
            },
            {
              element: <UserButton />,
              position: "right",
            },
            {
              type: "dark",
              position: "right",
            },
          ],
        }}
        sidebarResizable
        sidebarProps={{
          autoPopulateMenu: {
            startsWith: "/admin",
          },
        }}
        {...props.adminShellProps}
      />
    </AlephaMantineProvider>
  );
};

export default AdminLayout;
