import { useRouter } from "@alepha/react";
import { ActionButton, AdminShell, AlephaMantineProvider } from "@alepha/ui";
import { IconArrowLeft } from "@tabler/icons-react";
import type { DemoRouter } from "../DemoRouter.ts";

const DemoLayout = () => {
  const router = useRouter<DemoRouter>();
  return (
    <AlephaMantineProvider>
      <AdminShell
        appShellMainProps={{ h: "100%" }}
        appBarProps={{
          items: [
            {
              element: (
                <ActionButton variant="subtle" icon={IconArrowLeft} href="/" />
              ),
              position: "left",
            },
            {
              type: "dark",
              position: "right",
            },
          ],
        }}
        sidebarProps={{
          items: [
            router.node("demoHome"),
            {
              ...router.node("demoCore"),
              children: [
                router.node("demoTypeForm"),
                router.node("demoSidebar"),
                router.node("demoDataTable"),
              ],
            },
            {
              ...router.node("demoJson"),
              children: [router.node("demoJsonViewer")],
            },
            {
              ...router.node("demoAuth"),
              children: [router.node("demoLogin"), router.node("demoRegister")],
            },
          ],
        }}
      />
    </AlephaMantineProvider>
  );
};

export default DemoLayout;
