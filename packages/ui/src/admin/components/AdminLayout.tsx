import {
  ActionButton,
  AlephaMantineProvider,
  DashboardShell,
  type DashboardShellProps,
  SidebarCollapseButton,
  Text,
  ui,
} from "@alepha/ui";
import { Flex, Image } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";

export interface AdminLayoutProps {
  adminShellProps?: DashboardShellProps;
}

const AdminLayout = (props: AdminLayoutProps) => {
  return (
    <AlephaMantineProvider
      mantine={{
        theme: {
          components: {
            Button: {
              defaultProps: {
                fw: 400,
              },
            },
          },
        },
      }}
    >
      <DashboardShell
        layout={"alt"}
        navbarHeader={(props) => (
          <Flex gap={"md"} flex={1} px={"lg"} align={"center"}>
            <ActionButton
              href={"/"}
              variant={"default"}
              bd={0}
              icon={IconArrowLeft}
            />
            {!props.collapsed && (
              <>
                <Image pt={4} src={"/favicon.svg"} h={36} w={36} />
                <Flex direction={"column"}>
                  <Text bold>Blog</Text>
                  <Text small muted mt={-4}>
                    Admin Panel
                  </Text>
                </Flex>
              </>
            )}
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
