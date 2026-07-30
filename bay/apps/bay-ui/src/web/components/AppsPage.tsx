import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { AlertCircle } from "lucide-react";
import type { BayApp } from "../../api/services/BayControlService.ts";
import AppList from "./AppList.tsx";
import DeployCard from "./DeployCard.tsx";

export interface AppsPageProps {
  /**
   * Whether bay-ui has a `BAY_TOKEN` at all. Distinguished from an empty app
   * list so "nothing configured" never reads as "a Bay with no apps".
   */
  configured: boolean;
  apps: BayApp[];
}

const AppsPage = (props: AppsPageProps) => {
  if (!props.configured) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertDescription>
          No Bay is configured. Run <code>bay token</code> on the server, then
          set <code>BAY_URL</code> and <code>BAY_TOKEN</code> for bay-ui.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <DeployCard />
      <AppList apps={props.apps} />
    </div>
  );
};

export default AppsPage;
