import {
  ActionButton,
  AlephaMantineProvider,
  Breadcrumbs,
  DashboardShell,
  type DashboardShellProps,
  LanguageButton,
  SidebarCollapseButton,
  ThemeButton,
} from "@alepha/ui";
import { UserButton } from "@alepha/ui/auth";
import { Flex } from "@mantine/core";
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
        navbarHeader={
          <Flex px={"lg"} align={"center"} justify={"center"}>
            <ActionButton variant={"subtle"} icon={IconArrowLeft} href={"/"} />
          </Flex>
        }
        footerHeight={50}
        navbarFooter={
          <Flex flex={1} px={"lg"} gap={"md"} align={"center"}>
            <SidebarCollapseButton />
          </Flex>
        }
        appBarProps={{
          items: [
            {
              type: "burger",
              position: "left",
            },
            {
              element: <Breadcrumbs />,
              position: "left",
            },
            {
              element: <UserButton />,
              position: "right",
            },
            {
              element: <ThemeButton />,
              position: "right",
            },
            {
              element: <LanguageButton />,
              position: "right",
            },
            {
              type: "dark",
              position: "right",
            },
          ],
        }}
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
