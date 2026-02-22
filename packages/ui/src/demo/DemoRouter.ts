import {
  IconBell,
  IconBinaryTree,
  IconBraces,
  IconClick,
  IconForms,
  IconHeading,
  IconHome,
  IconKey,
  IconLayout,
  IconLayoutSidebar,
  IconLetterT,
  IconLockQuestion,
  IconLogin,
  IconMailCheck,
  IconMessage,
  IconPackages,
  IconRowInsertBottom,
  IconTable,
  IconUserPlus,
  IconWall,
} from "@tabler/icons-react";
import { $page } from "alepha/react/router";

export class DemoRouter {
  demoLayout = $page({
    icon: IconPackages,
    path: "/demo",
    label: "Demo",
    lazy: () => import("./components/DemoLayout.tsx"),
    children: () => [
      this.demoHome,
      this.demoCore,
      this.demoLayoutSection,
      this.demoForm,
      this.demoTable,
      this.demoJson,
      this.demoAuth,
    ],
  });

  demoHome = $page({
    icon: IconHome,
    path: "/",
    label: "Home",
    lazy: () => import("./components/DemoHome.tsx"),
  });

  // Core Components
  demoCore = $page({
    icon: IconWall,
    path: "/core",
    label: "Core",
    children: () => [
      this.demoFlex,
      this.demoText,
      this.demoButton,
      this.demoHeading,
    ],
  });

  demoFlex = $page({
    icon: IconRowInsertBottom,
    path: "/flex",
    label: "Flex",
    lazy: () => import("./components/core/DemoFlex.tsx"),
  });

  demoText = $page({
    icon: IconLetterT,
    path: "/text",
    label: "Text",
    lazy: () => import("./components/core/DemoText.tsx"),
  });

  demoHeading = $page({
    icon: IconHeading,
    path: "/heading",
    label: "Heading",
    lazy: () => import("./components/core/DemoHeading.tsx"),
  });

  demoButton = $page({
    icon: IconClick,
    path: "/button",
    label: "Button",
    lazy: () => import("./components/core/DemoButton.tsx"),
  });

  // Layout Components
  demoLayoutSection = $page({
    icon: IconLayout,
    path: "/layout",
    label: "Layout",
    children: () => [this.demoSidebar, this.demoDialog, this.demoToast],
  });

  demoSidebar = $page({
    icon: IconLayoutSidebar,
    path: "/sidebar",
    label: "Sidebar",
    lazy: () => import("./components/layout/DemoSidebar.tsx"),
  });

  demoDialog = $page({
    icon: IconMessage,
    path: "/dialog",
    label: "Dialog",
    lazy: () => import("./components/layout/DemoDialog.tsx"),
  });

  demoToast = $page({
    icon: IconBell,
    path: "/toast",
    label: "Toast",
    lazy: () => import("./components/layout/DemoToast.tsx"),
  });

  // Form Components
  demoForm = $page({
    icon: IconForms,
    path: "/form",
    label: "Form",
    children: () => [this.demoTypeForm],
  });

  demoTypeForm = $page({
    icon: IconForms,
    path: "/type-form",
    label: "TypeForm",
    lazy: () => import("./components/core/DemoTypeForm.tsx"),
  });

  // Table Components
  demoTable = $page({
    icon: IconTable,
    path: "/table",
    label: "Table",
    children: () => [this.demoDataTable],
  });

  demoDataTable = $page({
    icon: IconTable,
    path: "/data-table",
    label: "DataTable",
    lazy: () => import("./components/core/DemoDataTable.tsx"),
  });

  // JSON Components
  demoJson = $page({
    icon: IconBraces,
    path: "/json",
    label: "Json",
    children: () => [this.demoJsonViewer],
  });

  demoJsonViewer = $page({
    icon: IconBinaryTree,
    path: "/viewer",
    label: "JsonViewer",
    lazy: () => import("./components/json/DemoJsonViewer.tsx"),
  });

  // Auth Components
  demoAuth = $page({
    icon: IconKey,
    path: "/auth",
    label: "Auth",
    children: () => [
      this.demoLogin,
      this.demoRegister,
      this.demoResetPassword,
      this.demoVerifyEmail,
    ],
  });

  demoLogin = $page({
    icon: IconLogin,
    path: "/login",
    label: "Login",
    lazy: () => import("./components/auth/DemoLogin.tsx"),
  });

  demoRegister = $page({
    icon: IconUserPlus,
    path: "/register",
    label: "Register",
    lazy: () => import("./components/auth/DemoRegister.tsx"),
  });

  demoResetPassword = $page({
    icon: IconLockQuestion,
    path: "/reset-password",
    label: "ResetPassword",
    lazy: () => import("./components/auth/DemoResetPassword.tsx"),
  });

  demoVerifyEmail = $page({
    icon: IconMailCheck,
    path: "/verify-email",
    label: "VerifyEmail",
    lazy: () => import("./components/auth/DemoVerifyEmail.tsx"),
  });
}
