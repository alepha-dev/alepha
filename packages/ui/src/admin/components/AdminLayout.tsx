import {
  ActionButton,
  AdminShell,
  type AdminShellProps,
  AlephaMantineProvider,
  OmnibarButton,
} from "@alepha/ui";
import { UserButton } from "@alepha/ui/auth";
import { IconArrowLeft } from "@tabler/icons-react";

export interface AdminLayoutProps {
  adminShellProps?: AdminShellProps;
}

const AdminLayout = (props: AdminLayoutProps) => {
  return (
    <AlephaMantineProvider>
      <AdminShell
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
              element: <OmnibarButton />,
              position: "center",
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
