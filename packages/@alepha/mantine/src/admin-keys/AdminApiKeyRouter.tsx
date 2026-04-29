import { IconKey } from "@tabler/icons-react";
import type { AdminApiKeyController } from "alepha/api/keys";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

export class AdminApiKeyRouter {
  protected readonly apiKeyCtrl = $client<AdminApiKeyController>();

  adminApiKeys = $page({
    icon: IconKey,
    path: "/api-keys",
    label: "API Keys",
    description: "View and manage API keys for programmatic access.",
    head: { title: "API Keys" },
    can: () => this.apiKeyCtrl.findApiKeys.can(),
    lazy: () => import("./components/AdminApiKeys.tsx"),
  });
}
