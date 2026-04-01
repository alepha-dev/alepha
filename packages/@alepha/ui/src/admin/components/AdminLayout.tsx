import {
  ActionButton,
  AlephaMantineProvider,
  DashboardShell,
  type DashboardShellProps,
  SidebarCollapseButton,
  ui,
} from "@alepha/ui";
import { Flex } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";

export interface AdminLayoutProps {
  adminShellProps?: DashboardShellProps;
}

const AdminLayout = (props: AdminLayoutProps) => {
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
        navbarHeader={() => (
          <Flex gap={"md"} flex={1} px={"lg"} align={"center"}>
            <ActionButton
              href={"/"}
              variant={"default"}
              bd={0}
              icon={IconArrowLeft}
            />
          </Flex>
        )}
        footerHeight={48}
        navbarFooter={
          <Flex flex={1} px={"lg"} align={"center"}>
            <SidebarCollapseButton
              c={"gray"}
              size={"xs"}
              iconSize={ui.sizes.icon.sm}
              p={8}
              bd={0}
            />
          </Flex>
        }
        {...props.adminShellProps}
      />
    </AlephaMantineProvider>
  );
};

export default AdminLayout;
