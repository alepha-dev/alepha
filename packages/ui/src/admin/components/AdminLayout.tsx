import { NestedView, useRouter } from "@alepha/react";
import {
  ActionButton,
  AdminShell,
  OmnibarButton,
  ThemeButton,
} from "@alepha/ui";
import { UserButton } from "@alepha/ui/auth";
import { Flex } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import ToggleSidebarButton from "../../core/components/buttons/ToggleSidebarButton.tsx";
import type { AdminRouter } from "../AdminRouter.ts";

const AdminLayout = () => {
  const router = useRouter<AdminRouter>();
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
        menu: [
          {
            element: <ToggleSidebarButton />,
          },
          {
            type: "spacer",
          },
          {
            ...router.node("adminUsers"),
            description: undefined,
          },
          {
            ...router.node("adminSessions"),
            description: undefined,
          },
          {
            ...router.node("adminNotifications"),
            description: undefined,
          },
          {
            ...router.node("adminFiles"),
            description: undefined,
          },
        ],
      }}
    >
      <Flex flex={1} bg={"var(--alepha-surface)"}>
        <NestedView />
      </Flex>
    </AdminShell>
  );
};

export default AdminLayout;
