import { AlephaMantineProvider, DashboardShell } from "@alepha/ui";

export const Layout = () => {
  return (
    <AlephaMantineProvider>
      <DashboardShell
        sidebarProps={{
          items: [
            { label: "Home", href: "/" },
            { label: "About", href: "/about" },
          ],
        }}
        appBarProps={{
          items: [
            { position: "left", type: "burger" },
            { position: "center", type: "search" },
            { position: "right", type: "theme" },
            { position: "right", type: "lang" },
            { position: "right", type: "dark" },
          ],
        }}
      />
    </AlephaMantineProvider>
  );
};
