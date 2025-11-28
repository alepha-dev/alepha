import { NestedView, useRouter } from "@alepha/react";
import { AdminShell, AlephaMantineProvider } from "@alepha/ui";
import { Flex } from "@mantine/core";
import {
  IconChecklist,
  IconFileDatabase,
  IconJumpRope,
  IconMail,
  IconSettings,
  IconShield,
  IconTruckDelivery,
  IconUser,
} from "@tabler/icons-react";
import type { AdminRouter } from "../AdminRouter.ts";

const AdminLayout = () => {
  const router = useRouter<AdminRouter>();
  return (
    <AlephaMantineProvider>
      <AdminShell
        appShellMainProps={{
          bg: "var(--alepha-background)",
        }}
        appShellHeaderProps={{
          bg: "var(--alepha-background)",
        }}
        appShellNavbarProps={{
          bg: "var(--alepha-background)",
        }}
        appShellProps={{
          withBorder: false,
        }}
        appBarProps={{
          items: [
            {
              type: "search",
              position: "center",
            },
            {
              type: "dark",
              position: "right",
            },
          ],
        }}
        sidebarProps={{
          menu: [
            {
              type: "section",
              label: "Management",
            },
            {
              icon: IconUser,
              label: "Users",
              href: router.path("adminUsers"),
            },
            {
              icon: IconMail,
              label: "Notifications",
              href: "/admin/notifications",
            },
            {
              icon: IconShield,
              label: "Sessions",
              href: "/admin/sessions",
            },
            {
              icon: IconChecklist,
              label: "Verifications",
              href: "/admin/verifications",
            },
            {
              type: "section",
              label: "System",
            },
            {
              label: "Jobs",
              href: "/admin/jobs",
              icon: IconTruckDelivery,
            },
            {
              label: "Workflows",
              href: "/admin/workflows",
              icon: IconJumpRope,
            },
            {
              label: "Parameters",
              href: "/admin/parameters",
              icon: IconSettings,
            },
            {
              label: "Files",
              href: "/admin/files",
              icon: IconFileDatabase,
            },
          ],
        }}
      >
        <Flex
          flex={1}
          p={"lg"}
          mt={-16}
          ml={-16}
          bg={"var(--alepha-surface)"}
          bdrs={"lg"}
          bd={"1px solid var(--alepha-border)"}
        >
          <NestedView />
        </Flex>
      </AdminShell>
    </AlephaMantineProvider>
  );
};

export default AdminLayout;
