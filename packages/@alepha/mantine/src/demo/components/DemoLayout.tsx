import {
  AlephaMantineProvider,
  Breadcrumbs,
  DashboardShell,
  SidebarCollapseButton,
  ui,
} from "@alepha/mantine";
import { useRouter } from "alepha/react/router";
import type { DemoRouter } from "../DemoRouter.ts";

const DemoLayout = () => {
  const router = useRouter<DemoRouter>();
  return (
    <AlephaMantineProvider>
      <DashboardShell
        fill
        appShellProps={{
          withBorder: false,
          bg: ui.colors.background,
        }}
        appShellHeaderProps={{
          bg: "transparent",
          style: { backdropFilter: "blur(10px)" },
        }}
        appBarProps={{
          items: [
            {
              type: "burger",
              position: "left",
            },
            {
              element: <Breadcrumbs />,
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
                router.node("demoFlex"),
                router.node("demoText"),
                router.node("demoHeading"),
                router.node("demoButton"),
              ],
            },
            {
              ...router.node("demoLayoutSection"),
              children: [
                router.node("demoSidebar"),
                router.node("demoDialog"),
                router.node("demoToast"),
              ],
            },
            {
              ...router.node("demoForm"),
              children: [
                router.node("demoTypeForm"),
                router.node("demoControlSelect"),
              ],
            },
            {
              ...router.node("demoTable"),
              children: [router.node("demoDataTable")],
            },
            {
              ...router.node("demoJson"),
              children: [router.node("demoJsonViewer")],
            },
            {
              ...router.node("demoAuth"),
              children: [
                router.node("demoLogin"),
                router.node("demoRegister"),
                router.node("demoResetPassword"),
                router.node("demoVerifyEmail"),
              ],
            },
            {
              position: "bottom",
              element: <SidebarCollapseButton />,
            },
          ],
        }}
      />
    </AlephaMantineProvider>
  );
};

export default DemoLayout;
