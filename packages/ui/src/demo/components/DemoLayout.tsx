import { useRouter } from "@alepha/react";
import { ActionButton, AdminShell, AlephaMantineProvider } from "@alepha/ui";
import {
  IconAppWindow,
  IconArrowLeft,
  IconForms,
  IconLayoutSidebar,
  IconLogin,
  IconShield,
  IconTable,
  IconUsersPlus,
  IconWall,
} from "@tabler/icons-react";
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
            router.node("demoLayout"),
            {
              icon: IconWall,
              label: "Core",
              children: [
                {
                  icon: IconTable,
                  label: "DataTable",
                },
                {
                  icon: IconForms,
                  label: "Control",
                },
                {
                  icon: IconAppWindow,
                  label: "TypeForm",
                },
                {
                  icon: IconLayoutSidebar,
                  label: "Sidebar",
                },
              ],
            },
            {
              ...router.node("demoJson"),
              children: [router.node("demoJsonViewer")],
            },
            {
              icon: IconShield,
              label: "Auth",
              children: [
                {
                  icon: IconLogin,
                  label: "Login",
                },
                {
                  icon: IconUsersPlus,
                  label: "Register",
                },
              ],
            },
          ],
        }}
      />
    </AlephaMantineProvider>
  );
};

export default DemoLayout;
