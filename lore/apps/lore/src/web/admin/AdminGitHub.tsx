import { Button, Card, CardContent, CardHeader, CardTitle } from "@alepha/ui";
import { AdminPage, useConfirmedAction } from "@alepha/ui/admin";
import { Control } from "@alepha/ui/form";
import type { AdminGitHubController } from "@lore/core/api";
import { useAction, useClient, useQuery } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useRouterState } from "alepha/react/router";
import { GitPullRequest } from "lucide-react";
import { useEffect, useRef } from "react";

import AdminGitHubApp from "./AdminGitHubApp.tsx";
import AdminGitHubDeliveries from "./AdminGitHubDeliveries.tsx";
import { adminGitHubManifestFormSchema } from "./adminGitHubManifestFormSchema.ts";

/**
 * Admin > GitHub (#Q4360, epic #E177): the instance's one GitHub App.
 *
 * With no App, a form creates one through GitHub's manifest flow: the
 * server answers the manifest and a signed state, and the browser posts
 * them to GitHub in a form of its own, since GitHub reads the manifest from
 * a form post and nothing else. GitHub sends the admin back here with
 * `?code&state`, which this page hands to the server once, then drops from
 * the address.
 *
 * With one, the page shows where it comes from, its slug and install link,
 * the webhook URL and whether GitHub's ping reached it. No secret is ever
 * shown. Literal English, like the rest of the Lore admin.
 */
const AdminGitHub = () => {
  const client = useClient<AdminGitHubController>();
  const router = useRouterState();
  const code = router.url.searchParams.get("code") ?? undefined;
  const state = router.url.searchParams.get("state") ?? undefined;

  const status = useQuery(
    {
      key: ["admin-github-app"],
      handler: () => client.getGitHubApp(),
    },
    [client],
  );

  const form = useForm({
    schema: adminGitHubManifestFormSchema,
    initialValues: { name: "", organization: "" },
    handler: () => undefined,
  });
  const values = useFormValues(form);

  const create = useAction<[], void>(
    {
      handler: async () => {
        const start = await client.startGitHubAppManifest({
          body: {
            ...(values.name?.trim() ? { name: values.name.trim() } : {}),
            ...(values.organization?.trim()
              ? { organization: values.organization.trim() }
              : {}),
          },
        });
        const post = document.createElement("form");
        post.method = "POST";
        post.action = start.action;
        const field = document.createElement("input");
        field.type = "hidden";
        field.name = "manifest";
        field.value = start.manifest;
        post.appendChild(field);
        document.body.appendChild(post);
        post.submit();
      },
    },
    [client, values.name, values.organization],
  );

  const complete = useAction<[code: string, state: string], void>(
    {
      handler: async (_context, returned, returnedState) => {
        await client.completeGitHubAppManifest({
          body: { code: returned, state: returnedState },
        });
        await status.refetch();
      },
    },
    [client, status],
  );

  // GitHub's one-time code, handed over once, then dropped from the address
  // so a reload does not send a used code again.
  const handed = useRef(false);
  useEffect(() => {
    if (!code || !state || handed.current) return;
    handed.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    void complete.run(code, state);
  }, [code, state, complete]);

  const remove = useConfirmedAction(
    {
      confirm: () => ({
        title: "Forget this GitHub App?",
        description:
          "Connected projects stop receiving GitHub events and agent jobs lose their GitHub token. The App stays on GitHub.",
        confirmLabel: "Forget",
        destructive: true,
      }),
      handler: async () => {
        await client.removeGitHubApp();
        await status.refetch();
      },
      success: () => "GitHub App forgotten",
    },
    [client, status],
  );

  const app = status.data;
  const busy = create.loading || complete.loading;

  return (
    <AdminPage>
      <div className="flex max-w-3xl flex-col gap-4" data-testid="admin-github">
        {app?.configured ? (
          <>
            <AdminGitHubApp app={app} onRemove={() => remove.run()} />
            <AdminGitHubDeliveries />
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitPullRequest className="size-4" />
                GitHub App
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {app?.missing && app.missing.length > 0 && (
                <p className="text-sm" data-testid="admin-github-missing">
                  Missing: {app.missing.join(", ")}
                </p>
              )}
              {!app?.webhookUrl && app && (
                <p className="text-sm" data-testid="admin-github-no-url">
                  PUBLIC_URL is not set
                </p>
              )}
              <Control
                input={form.input.name}
                label="App name"
                disabled={busy}
                inputProps={{ "data-testid": "admin-github-name" }}
              />
              <Control
                input={form.input.organization}
                label="Organization"
                disabled={busy}
                inputProps={{ "data-testid": "admin-github-organization" }}
              />
              <div>
                <Button
                  type="button"
                  disabled={busy || !app?.webhookUrl}
                  onClick={() => create.run()}
                  data-testid="admin-github-create"
                >
                  Create the GitHub App
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AdminPage>
  );
};

export default AdminGitHub;
