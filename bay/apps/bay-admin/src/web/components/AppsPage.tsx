import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { AlertCircle } from "lucide-react";
import type { BayApp } from "../../api/services/BayControlService.ts";
import AppList from "./AppList.tsx";
import DeployCard from "./DeployCard.tsx";

export interface AppsPageProps {
  /**
   * Whether bay-admin can reach Bay's control socket at all. Distinguished
   * from an empty app list so "cannot reach Bay" never reads as "a Bay with no
   * apps".
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
          Bay's control socket is unreachable. bay-admin must run on the Bay
          host, deployed with <code>--allow-control-api</code>, and{" "}
          <code>BAY_SOCKET</code> must point at it.
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
