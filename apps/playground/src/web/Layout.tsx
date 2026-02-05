import { AlephaMantineProvider, DashboardShell } from "@alepha/ui";

export const Layout = () => {
  return (
    <AlephaMantineProvider>
      <DashboardShell
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
