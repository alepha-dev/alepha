import { IconCreditCard } from "@tabler/icons-react";
import type { AdminPaymentController } from "alepha/api/payments";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

export class AdminPaymentRouter {
  protected readonly paymentsCtrl = $client<AdminPaymentController>();

  adminPayments = $page({
    icon: IconCreditCard,
    path: "/payments",
    label: "Payments",
    description: "Manage payment intents and transactions.",
    head: { title: "Payments" },
    can: () => this.paymentsCtrl.listIntents.can(),
    lazy: () => import("./components/AdminPayments.tsx"),
  });
}
