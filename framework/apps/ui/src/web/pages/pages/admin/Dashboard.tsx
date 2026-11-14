import {
  AdminDashboard,
  type AdminDashboardCard,
  AdminStatTile,
} from "@alepha/ui/admin";
import { z } from "alepha";
import { useClient } from "alepha/react";
import { FileSearch, Files, KeyRound, UsersIcon } from "lucide-react";

import type { ShowcaseAuditsController } from "@/showcase/admin/ShowcaseAuditsController.ts";
import type { ShowcaseFilesController } from "@/showcase/admin/ShowcaseFilesController.ts";
import type { ShowcaseKeysController } from "@/showcase/admin/ShowcaseKeysController.ts";
import type { ShowcaseUsersController } from "@/showcase/admin/ShowcaseUsersController.ts";
import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * `AdminDashboard` takes its tiles as a prop and renders nothing without them,
 * which is the honest reading of "no module this dashboard can read is
 * registered". The knob gates the last card off so that disappearance is
 * visible rather than described.
 */
const KNOBS = z.object({
  showGated: z.boolean().default(false).meta({ title: "Ungate the 5th card" }),
});

type CountClient = ShowcaseUsersController &
  ShowcaseFilesController &
  ShowcaseKeysController &
  ShowcaseAuditsController;

type CountAction = "findUsers" | "findFiles" | "findApiKeys" | "findAudits";

const Dashboard = () => {
  const client = useClient<CountClient>();

  const count = async (action: CountAction) => {
    const page = await client[action]({ query: { page: 0, size: 1 } });
    return page.page.totalElements ?? 0;
  };

  const tile = (
    id: string,
    label: string,
    description: string,
    icon: React.ReactNode,
    href: string,
    action: CountAction,
    order: number,
  ): AdminDashboardCard => ({
    id,
    title: label,
    description,
    order,
    render: () => (
      <AdminStatTile
        id={id}
        label={label}
        tooltip={description}
        icon={icon}
        href={href}
        load={() => count(action)}
      />
    ),
  });

  return (
    <Showcase
      id="pages/admin/Dashboard"
      title="Admin: dashboard"
      description="The admin landing page."
      schema={KNOBS}
      initialValues={{ showGated: false }}
    >
      {(v) => (
        <AdminDashboard
          key={String(v.showGated)}
          cards={[
            tile(
              "users",
              "Users",
              "Accounts in this realm",
              <UsersIcon className="size-4" />,
              "/pages/admin/users",
              "findUsers",
              1000,
            ),
            tile(
              "files",
              "Files",
              "Across every bucket",
              <Files className="size-4" />,
              "/pages/admin/files",
              "findFiles",
              1010,
            ),
            tile(
              "keys",
              "API keys",
              "Active, revoked excluded",
              <KeyRound className="size-4" />,
              "/pages/admin/keys",
              "findApiKeys",
              1020,
            ),
            tile(
              "audits",
              "Audit entries",
              "Recorded in the log",
              <FileSearch className="size-4" />,
              "/pages/admin/audits",
              "findAudits",
              1030,
            ),
            {
              id: "gated",
              title: "Gated card",
              order: 1040,
              can: () => v.showGated,
              render: () => (
                <AdminStatTile
                  id="gated"
                  label="Gated card"
                  note="Hidden when its `can` returns false"
                  href="/pages/admin/dashboard"
                  load={async () => 0}
                />
              ),
            },
          ]}
        />
      )}
    </Showcase>
  );
};

export default Dashboard;
