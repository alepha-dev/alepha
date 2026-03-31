import { IconCreditCard } from "@tabler/icons-react";
import type { AdminBillingController } from "alepha/billing";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

export class AdminBillingRouter {
  protected readonly billingCtrl = $client<AdminBillingController>();

  adminBilling = $page({
    icon: IconCreditCard,
    path: "/billing",
    label: "Billing",
    description: "Manage payment intents and transactions.",
    head: { title: "Billing" },
    can: () => this.billingCtrl.listIntents.can(),
    lazy: () => import("./components/AdminBilling.tsx"),
  });
}
