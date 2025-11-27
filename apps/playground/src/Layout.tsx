import { AdminShell, AlephaMantineProvider } from "@alepha/ui";
import { UserButton } from "@alepha/ui/auth";

export const Layout = () => {
  return (
    <AlephaMantineProvider>
      <AdminShell
        noSidebarWhen={{
          paths: ["/auth"],
        }}
        sidebarProps={{}}
        appBarProps={{
          items: [
            { position: "center", type: "search" },
            { position: "right", element: <UserButton /> },
            { position: "right", type: "lang" },
            { position: "right", type: "dark" },
          ],
        }}
      />
    </AlephaMantineProvider>
  );
};
