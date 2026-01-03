import { $page } from "@alepha/react";
import {
  IconBinaryTree,
  IconBraces,
  IconForms,
  IconHome,
  IconKey,
  IconLayoutSidebar,
  IconLockQuestion,
  IconLogin,
  IconMailCheck,
  IconPackages,
  IconTable,
  IconUserPlus,
  IconWall,
} from "@tabler/icons-react";

export class DemoRouter {
  demoLayout = $page({
    icon: IconPackages,
    path: "/demo",
    label: "Demo",
    lazy: () => import("./components/DemoLayout.tsx"),
    children: () => [
      this.demoHome,
      this.demoCore,
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
    children: () => [this.demoTypeForm, this.demoSidebar, this.demoDataTable],
  });

  demoTypeForm = $page({
    icon: IconForms,
    path: "/type-form",
    label: "TypeForm",
    lazy: () => import("./components/core/DemoTypeForm.tsx"),
  });

  demoSidebar = $page({
    icon: IconLayoutSidebar,
    path: "/sidebar",
    label: "Sidebar",
    lazy: () => import("./components/core/DemoSidebar.tsx"),
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
