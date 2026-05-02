import { AdminAudits } from "@alepha/ui/components/admin/admin-audits";
import { AdminFiles } from "@alepha/ui/components/admin/admin-files";
import { AdminJobs } from "@alepha/ui/components/admin/admin-jobs";
import { AdminNotifications } from "@alepha/ui/components/admin/admin-notifications";
import { AdminParameters } from "@alepha/ui/components/admin/admin-parameters";
import { $page, Redirection } from "alepha/react/router";
import { Layout } from "./Layout.tsx";
import AutoFormDemo from "./pages/demo/AutoForm.tsx";
import Dialogs from "./pages/demo/Dialogs.tsx";
import AddressForm from "./pages/demo/forms/Address.tsx";
import FormsIndex from "./pages/demo/forms/Forms.tsx";
import LoginForm from "./pages/demo/forms/Login.tsx";
import PaymentForm from "./pages/demo/forms/Payment.tsx";
import RegisterForm from "./pages/demo/forms/Register.tsx";
import SelectsForm from "./pages/demo/forms/Selects.tsx";
import Toasts from "./pages/demo/Toasts.tsx";
import Audits from "./pages/playgrounds/Audits.tsx";
import Jobs from "./pages/playgrounds/Jobs.tsx";
import Notifications from "./pages/playgrounds/Notifications.tsx";

export class AppRouter {
  layout: any = $page({
    component: Layout,
    children: (): any[] => [
      this.home,
      this.playgroundJobs,
      this.playgroundNotifications,
      this.playgroundAudits,
      this.adminJobs,
      this.adminAudits,
      this.adminNotifications,
      this.adminFiles,
      this.adminParameters,
      this.demoToasts,
      this.demoDialogs,
      this.demoAutoForm,
      this.demoForms,
      this.demoFormsLogin,
      this.demoFormsRegister,
      this.demoFormsAddress,
      this.demoFormsPayment,
      this.demoFormsSelects,
    ],
  });

  home: any = $page({
    parent: this.layout,
    path: "/",
    loader: async () => {
      throw new Redirection("/resources/jobs");
    },
    component: () => null,
  });

  playgroundJobs: any = $page({
    parent: this.layout,
    path: "/playgrounds/jobs",
    head: { title: "Jobs playground" },
    component: Jobs,
  });

  playgroundNotifications: any = $page({
    parent: this.layout,
    path: "/playgrounds/notifications",
    head: { title: "Notifications playground" },
    component: Notifications,
  });

  playgroundAudits: any = $page({
    parent: this.layout,
    path: "/playgrounds/audits",
    head: { title: "Audits playground" },
    component: Audits,
  });

  adminJobs: any = $page({
    parent: this.layout,
    path: "/resources/jobs",
    head: { title: "Jobs" },
    component: AdminJobs,
  });

  adminAudits: any = $page({
    parent: this.layout,
    path: "/resources/audits",
    head: { title: "Audit log" },
    component: AdminAudits,
  });

  adminNotifications: any = $page({
    parent: this.layout,
    path: "/resources/notifications",
    head: { title: "Notifications" },
    component: AdminNotifications,
  });

  adminFiles: any = $page({
    parent: this.layout,
    path: "/resources/files",
    head: { title: "Files" },
    component: AdminFiles,
  });

  adminParameters: any = $page({
    parent: this.layout,
    path: "/resources/parameters",
    head: { title: "Parameters" },
    component: AdminParameters,
  });

  demoToasts: any = $page({
    parent: this.layout,
    path: "/demo/toasts",
    head: { title: "Toasts demo" },
    component: Toasts,
  });

  demoDialogs: any = $page({
    parent: this.layout,
    path: "/demo/dialogs",
    head: { title: "Dialogs demo" },
    component: Dialogs,
  });

  demoAutoForm: any = $page({
    parent: this.layout,
    path: "/demo/auto-form",
    head: { title: "AutoForm demo" },
    component: AutoFormDemo,
  });

  demoForms = $page({
    path: "/demo/forms",
    head: { title: "Forms gallery" },
    component: FormsIndex,
  });

  demoFormsLogin = $page({
    path: "/demo/forms/login",
    head: { title: "Login form" },
    component: LoginForm,
  });

  demoFormsRegister = $page({
    path: "/demo/forms/register",
    head: { title: "Register form" },
    component: RegisterForm,
  });

  demoFormsAddress = $page({
    path: "/demo/forms/address",
    head: { title: "Address form" },
    component: AddressForm,
  });

  demoFormsPayment = $page({
    path: "/demo/forms/payment",
    head: { title: "Payment form" },
    component: PaymentForm,
  });

  demoFormsSelects = $page({
    path: "/demo/forms/selects",
    head: { title: "Select variants" },
    component: SelectsForm,
  });
}
