import {
  ActionButton,
  AdminShell,
  type AdminShellProps,
  AlephaMantineProvider,
  OmnibarButton,
  ThemeButton,
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
