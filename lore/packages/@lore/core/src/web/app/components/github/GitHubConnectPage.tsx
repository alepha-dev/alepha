import { Button, Card, CardContent, CardHeader, CardTitle } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { z } from "alepha";
import { useAction, useClient } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { GitPullRequest } from "lucide-react";
import { useEffect, useState } from "react";

import type { ProjectGitHubController } from "../../../../api/controllers/ProjectGitHubController.ts";
import type { GitHubConnectCallbackResult } from "../../../../api/schemas/githubConnectCallbackResultSchema.ts";
import type { I18n } from "../../services/I18n.ts";

export interface GitHubConnectPageProps {
  result?: GitHubConnectCallbackResult;
  error?: string;
}

/**
 * `/github/connect` (#Q4362): where GitHub sends a member back after
 * installing the instance's App, the App's callback URL.
 *
 * The page's loader (`CoreRouter.githubConnect`) hands GitHub's query to the
 * server once; this page shows what came of it. Connected at once, it goes to
 * the project's settings; with several repositories it offers the ones the
 * member's GitHub account reaches; a request an organization owner must
 * approve says so. The used code is dropped from the address.
 */
const GitHubConnectPage = (props: GitHubConnectPageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<any>();
  const api = useClient<ProjectGitHubController>();
  const [error, setError] = useState<string | undefined>(props.error);
  const result = props.result;

  const toSettings = (slug: string) =>
    router.push("projectSettingsBanner", { params: { projectSlug: slug } });

  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
    if (result?.outcome === "connected") {
      void toSettings(result.projectSlug);
    }
    // Once, at mount: the loader's answer does not change.
  }, []);

  const form = useForm({
    schema: z.object({ repositoryId: z.text() }),
    initialValues: { repositoryId: "" },
    handler: () => undefined,
  });
  const values = useFormValues(form);

  const connect = useAction<[], void>(
    {
      handler: async () => {
        if (!result?.pick) return;
        await api.connectProjectGitHub({
          params: { projectId: result.projectId },
          body: {
            pick: result.pick,
            repositoryId: Number(values.repositoryId),
          },
        });
        await toSettings(result.projectSlug);
      },
      onError: (caught) =>
        setError(caught instanceof Error ? caught.message : String(caught)),
    },
    [api, result, values.repositoryId],
  );

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-6">
      <Card data-testid="github-connect">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitPullRequest className="size-4" />
            {tr("github.connect.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {error ? (
            <p className="text-destructive" data-testid="github-connect-error">
              {error}
            </p>
          ) : !result || result.outcome === "connected" ? (
            <p className="text-muted-foreground">
              {tr("github.connect.working")}
            </p>
          ) : result.outcome === "requested" ? (
            <p data-testid="github-connect-requested">
              {tr("github.connect.requested")}
            </p>
          ) : (
            <>
              <Control
                select
                items={(result.repositories ?? []).map((repo) => ({
                  value: String(repo.id),
                  label: repo.fullName,
                }))}
                input={form.input.repositoryId}
                label={tr("github.connect.repository")}
                disabled={connect.loading}
              />
              <div>
                <Button
                  type="button"
                  disabled={!values.repositoryId || connect.loading}
                  onClick={() => connect.run()}
                  data-testid="github-connect-submit"
                >
                  {tr("github.connect.submit")}
                </Button>
              </div>
            </>
          )}
          {result && (
            <div>
              <Button
                type="button"
                variant="minimal"
                onClick={() => toSettings(result.projectSlug)}
              >
                {tr("github.connect.back")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default GitHubConnectPage;
