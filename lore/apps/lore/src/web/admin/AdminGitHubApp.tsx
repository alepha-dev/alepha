import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  TimeAgo,
} from "@alepha/ui";
import type { GitHubAppStatus } from "@lore/core/schemas";
import { Download, ExternalLink, GitPullRequest } from "lucide-react";

export interface AdminGitHubAppProps {
  app: GitHubAppStatus;
  onRemove: () => void;
}

/**
 * The configured App: identity, links and the webhook's reachability.
 */
const AdminGitHubApp = (props: AdminGitHubAppProps) => {
  const app = props.app;
  return (
    <Card data-testid="admin-github-app">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitPullRequest className="size-4" />
          {app.name ?? app.slug}
          <Badge variant="tint" tone="neutral">
            {app.source === "environment" ? "Environment" : "Stored"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Slug</dt>
          <dd>
            {app.htmlUrl ? (
              <a
                href={app.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline"
              >
                {app.slug}
                <ExternalLink className="size-3" />
              </a>
            ) : (
              app.slug
            )}
          </dd>
          <dt className="text-muted-foreground">App id</dt>
          <dd>{app.appId}</dd>
          {app.ownerLogin && (
            <>
              <dt className="text-muted-foreground">Owner</dt>
              <dd>{app.ownerLogin}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Install link</dt>
          <dd>
            {app.installUrl && (
              <a
                href={app.installUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all underline"
                data-testid="admin-github-install"
              >
                {app.installUrl}
              </a>
            )}
          </dd>
          <dt className="text-muted-foreground">Logo</dt>
          <dd className="flex flex-col gap-1" data-testid="admin-github-logo">
            <span>
              GitHub takes an App's logo in its settings, under Display
              information: Lore cannot set it.
            </span>
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              {app.settingsUrl && (
                <a
                  href={app.settingsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline"
                  data-testid="admin-github-settings"
                >
                  The App's settings on GitHub
                  <ExternalLink className="size-3" />
                </a>
              )}
              <a
                href="/logo-512x512.png"
                download="lore-logo.png"
                className="inline-flex items-center gap-1 underline"
                data-testid="admin-github-logo-download"
              >
                Lore's logo
                <Download className="size-3" />
              </a>
            </span>
          </dd>
          <dt className="text-muted-foreground">Webhook URL</dt>
          <dd className="break-all">
            {app.webhookUrl ?? "PUBLIC_URL is not set"}
          </dd>
          <dt className="text-muted-foreground">Webhook</dt>
          <dd data-testid="admin-github-webhook">
            {app.webhookPingAt ? (
              <Badge variant="tint" tone="success">
                Reached <TimeAgo value={app.webhookPingAt} />
              </Badge>
            ) : (
              <Badge variant="tint" tone="warning">
                Not reached yet
              </Badge>
            )}
          </dd>
        </dl>
        {app.source === "stored" && (
          <div className="mt-4">
            <Button
              type="button"
              variant="outlined"
              intent="danger"
              onClick={props.onRemove}
              data-testid="admin-github-remove"
            >
              Forget this App
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AdminGitHubApp;
