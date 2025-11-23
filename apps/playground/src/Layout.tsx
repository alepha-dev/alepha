import { AdminShell, AlephaMantineProvider } from "@alepha/ui";

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
            { position: "right", type: "lang" },
            { position: "right", type: "dark" },
          ],
        }}
      />
    </AlephaMantineProvider>
  );
};
