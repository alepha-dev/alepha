import { NestedView, useInject, useRouter } from "@alepha/react";
import {
  ActionButton,
  AdminShell,
  OmnibarButton,
  ThemeButton,
} from "@alepha/ui";
import { UserButton } from "@alepha/ui/auth";
import { Flex } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import type { AdminRouter } from "../AdminRouter.ts";
import { AdminSidebar } from "../AdminSidebar.ts";

const AdminLayout = () => {
  const router = useRouter<AdminRouter>();
  const sidebar = useInject(AdminSidebar);

  return (
    <AdminShell
      appShellMainProps={{
        bg: "var(--alepha-surface)",
      }}
      appShellHeaderProps={{
        bg: "var(--alepha-background)",
      }}
      appShellNavbarProps={
        {
          //  bg: "var(--alepha-background)",
        }
      }
      appShellProps={
        {
          // withBorder: false,
        }
      }
      appShellFooterProps={{
        bg: "var(--alepha-background)",
      }}
      footer={<Flex h={12} />}
      appBarProps={{
        items: [
          {
            element: <ActionButton icon={IconArrowLeft} href={"/"} />,
            position: "left",
          },
          {
            element: <OmnibarButton actionProps={{ variant: "outline" }} />,
            position: "right",
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
            type: "dark",
            position: "right",
          },
        ],
      }}
      sidebarProps={{
        gap: "xs",
        menu: sidebar.menu(router),
      }}
    >
      <Flex flex={1} bg={"var(--alepha-surface)"}>
        <NestedView />
      </Flex>
    </AdminShell>
  );
};

export default AdminLayout;
