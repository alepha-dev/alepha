import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { AppSecretController } from "@/api/controllers/AppSecretController.ts";

import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { useRank } from "../../shared/useRank.ts";
import AppEnvironmentAdd from "./AppEnvironmentAdd.tsx";
import AppEnvironmentRow from "./AppEnvironmentRow.tsx";

/**
 * The Environment tab: what this deployed copy runs with.
 *
 * ## ⚠️ This page never receives a value
 *
 * The endpoint answers key names, a four-character prefix of the long ones and
 * who set them last. It does not answer values, to anybody, the project owner
 * included - so there is nothing here to reveal, no "show" affordance to add,
 * and editing is replacing rather than amending. A `type="password"` input
 * would have looked like the same thing and would have shipped the real value
 * to every browser that opened the tab.
 *
 * ## The empty state is the normal one
 *
 * A copy starts with no variables and deploys perfectly well with none:
 * `DATABASE_URL`, `R2_BUCKET_NAME` and the `CLOUDFLARE_*` names are derived by
 * the deploy from the resources it provisions, which is why they are refused
 * here rather than offered as fields to fill in.
 *
 * ⚠️ A UI affordance and not the boundary: a member sees the list read-only
 * because the write endpoints are owner-gated server-side, and hiding a button
 * refuses nothing.
 */
const AppEnvironment = () => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const secretApi = useClient<AppSecretController>();
  const [project] = useStore(currentProjectAtom);
  const [instance] = useStore(currentInstanceAtom);

  const { data, loading, error, refetch } = useQuery(
    {
      enabled: Boolean(project && instance),
      key: ["app-secrets", project?.id, instance?.id],
      handler: async () => {
        if (!project || !instance) return undefined;
        return await secretApi.listAppSecrets({
          params: { projectId: project.id, instanceId: instance.id },
        });
      },
    },
    [project?.id, instance?.id],
  );

  if (!project || !instance) {
    return null;
  }

  const items = data?.items ?? [];
  // Rank, not ownership: `deploy:manage` is its own permission and an owner
  // may have granted it to a rank. ⚠️ Never the boundary - the endpoints refuse
  // server-side, and a hidden button refuses nothing.
  const canDeploy = can("deploy:manage");

  return (
    <div className="flex flex-col gap-4 p-2">
      <Card data-testid="app-environment">
        <CardHeader>
          <CardTitle className="text-base">{tr("app.environment")}</CardTitle>
          <CardDescription>{tr("app.environment.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {/*
            Three states, and the empty one is not the error one. Folding them
            together is how "nothing set" comes to read as "something is
            broken" to somebody who cannot tell the difference.
          */}
          {loading && !data ? (
            <p className="text-muted-foreground text-sm">
              {tr("app.environment.loading")}
            </p>
          ) : error ? (
            <p className="text-muted-foreground text-sm">
              {tr("app.environment.error")}
            </p>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {tr("app.environment.empty")}
            </p>
          ) : (
            <div className="flex flex-col divide-y">
              {items.map((item) => (
                <AppEnvironmentRow
                  key={item.id}
                  secret={item}
                  projectId={project.id}
                  instanceId={instance.id}
                  canWrite={canDeploy}
                  onChanged={refetch}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canDeploy ? (
        <AppEnvironmentAdd
          projectId={project.id}
          instanceId={instance.id}
          onSaved={refetch}
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          {tr("app.environment.ownerOnly")}
        </p>
      )}
    </div>
  );
};

export default AppEnvironment;
