import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useAction, useClient } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { DatabaseBackup, ExternalLink, Square } from "lucide-react";
import type { BayAppController } from "../../api/controllers/BayAppController.ts";
import type { BayApp } from "../../api/services/BayControlService.ts";

export interface AppListProps {
  apps: BayApp[];
}

const AppList = (props: AppListProps) => {
  const bayApi = useClient<BayAppController>();
  const router = useRouter();
  const dialog = useDialog();

  const stop = useAction<[BayApp]>(
    {
      handler: async (app) => {
        // Stopping takes a site offline. Confirm through the imperative dialog
        // API — `window.confirm` is banned in this codebase.
        const confirmed = await dialog.confirm({
          title: `Stop ${app.name}/${app.env}?`,
          description: `${app.domain} will stop answering until it is deployed again.`,
          confirmLabel: "Stop",
          destructive: true,
        });
        if (!confirmed) {
          return;
        }
        await bayApi.stopApp({ params: { name: app.name, env: app.env } });
        await router.reload();
      },
    },
    [],
  );

  const backup = useAction<[BayApp]>(
    {
      handler: async (app) => {
        await bayApi.backupApp({ params: { name: app.name, env: app.env } });
      },
    },
    [],
  );

  if (!props.apps.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No apps yet</CardTitle>
          <CardDescription>
            Deploy an artifact above and it will appear here.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Apps</CardTitle>
        <CardDescription>{props.apps.length} deployed</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {props.apps.map((app) => (
          <div
            key={`${app.name}/${app.env}`}
            className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2">
                <span className="font-medium">{app.name}</span>
                <Badge variant="secondary">{app.env}</Badge>
              </div>
              <a
                href={`https://${app.domain}/`}
                target="_blank"
                rel="noreferrer"
                className="truncate text-sm text-muted-foreground hover:underline"
              >
                {app.domain}
                <ExternalLink className="ml-1 inline size-3" />
              </a>
            </div>
            <span className="text-sm text-muted-foreground">{app.release}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={backup.loading}
              onClick={() => backup.run(app)}
            >
              <DatabaseBackup />
              Backup
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={stop.loading}
              onClick={() => stop.run(app)}
            >
              <Square />
              Stop
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default AppList;
