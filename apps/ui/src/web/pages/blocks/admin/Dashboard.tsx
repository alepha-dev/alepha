// A DEFAULT import: `admin-dashboard` is a lazy-loaded router page, so it
// default-exports its component rather than naming it.
import AdminDashboard from "@alepha/ui/components/admin/admin-dashboard";
import type { AdminDashboardCard } from "@alepha/ui/components/admin/admin-dashboard-card";
import { AdminDashboardCountCard } from "@alepha/ui/components/admin/admin-dashboard-count-card";
import { useClient } from "alepha/react";
import { FileSearch, Files, KeyRound, UsersIcon } from "lucide-react";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * `AdminDashboard` takes its tiles as a prop and renders nothing without them,
 * which is the honest reading of "no module this dashboard can read is
 * registered" rather than a page of dashes. `AdminRouter` normally supplies
 * that list; here the page supplies it directly, which is also the clearest way
 * to show what a card actually is.
 *
 * Each tile resolves its own count through the same client the rest of the site
 * uses, and a rejection renders a dash rather than taking the page down.
 */
const Dashboard = () => {
  const client = useClient() as unknown as CountClient;

  const count = async (action: keyof CountClient): Promise<number> => {
    const page = await client[action]({ query: { page: 0, size: 1 } });
    return page.page.totalElements ?? 0;
  };

  const cards: AdminDashboardCard[] = [
    {
      id: "users",
      order: 1000,
      render: () => (
        <AdminDashboardCountCard
          label="Users"
          description="The admin landing page."
          icon={<UsersIcon className="size-4" />}
          href="/blocks/admin/users"
          load={() => count("findUsers")}
        />
      ),
    },
    {
      id: "files",
      order: 1010,
      render: () => (
        <AdminDashboardCountCard
          label="Files"
          description="Stored across every bucket"
          icon={<Files className="size-4" />}
          href="/blocks/admin/files"
          load={() => count("findFiles")}
        />
      ),
    },
    {
      id: "keys",
      order: 1020,
      render: () => (
        <AdminDashboardCountCard
          label="API keys"
          description="Active, revoked excluded"
          icon={<KeyRound className="size-4" />}
          href="/blocks/admin/keys"
          load={() => count("findApiKeys")}
        />
      ),
    },
    {
      id: "audits",
      order: 1030,
      render: () => (
        <AdminDashboardCountCard
          label="Audit entries"
          description="Recorded in the log"
          icon={<FileSearch className="size-4" />}
          href="/blocks/admin/audits"
          load={() => count("findAudits")}
        />
      ),
    },
    {
      id: "hidden",
      order: 1040,
      // Gated off on purpose, to show that a card whose backend is absent
      // disappears entirely rather than rendering an empty tile.
      can: () => false,
      render: () => (
        <AdminDashboardCountCard
          label="Never rendered"
          href="/"
          load={async () => 0}
        />
      ),
    },
  ];

  return (
    <BlockPage
      title="Admin: dashboard"
      description="Whatever cards survive their own gate."
    >
      <Specimen title="AdminDashboard">
        <AdminDashboard cards={cards} />
      </Specimen>
    </BlockPage>
  );
};

interface CountClient {
  findUsers: (a: CountArgs) => Promise<CountPage>;
  findFiles: (a: CountArgs) => Promise<CountPage>;
  findApiKeys: (a: CountArgs) => Promise<CountPage>;
  findAudits: (a: CountArgs) => Promise<CountPage>;
}

interface CountArgs {
  query: Record<string, unknown>;
}

interface CountPage {
  page: { totalElements?: number };
}

export default Dashboard;
