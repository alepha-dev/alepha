import {
  Button,
  Input,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useToast,
} from "@alepha/ui";
import { SettingsRow } from "@alepha/ui/settings";
import { useRank, currentProjectAtom, type I18n } from "@lore/core/web";
import { useAction, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { AppController } from "../../../../../api/controllers/AppController.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";

/**
 * The hosts a Bay copy answers on, canonical first (#Q3796).
 *
 * Saved on the copy and sent with its next deploy, which is when the
 * machine replaces its list: saving alone moves nothing, and the toast says
 * so. An empty field clears the list, leaving the domains to the machine.
 * Shown only for a copy on a Bay host that is not a stack member: a
 * Cloudflare copy's address is its custom domain, and a stack member
 * answers on its environment's routes.
 *
 * ⚠️ Key this by `instance.id` wherever it is mounted, like
 * `AppSettingsUrl`: the draft is seeded once.
 */
const AppSettingsDomains = () => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const toaster = useToast();
  const appApi = useClient<AppController>();

  const [project] = useStore(currentProjectAtom);
  const [instance, setInstance] = useStore(currentInstanceAtom);
  const [instances, setInstances] = useStore(currentInstancesAtom);

  const stored = (instance?.domains ?? []).join(", ");
  const [draft, setDraft] = useState(stored);

  const saveAction = useAction<[], void>(
    {
      handler: async () => {
        if (!project || !instance) return;
        const domains = draft
          .split(/[\s,]+/)
          .map((it) => it.trim())
          .filter(Boolean);
        const updated = await appApi.updateApp({
          params: {
            projectId: project.id,
            app: instance.app,
            env: instance.env,
          },
          body: { domains },
        });
        setInstance(updated);
        setInstances(
          (instances ?? []).map((it) => (it.id === updated.id ? updated : it)),
        );
        // Back from the server, lowercased and deduplicated.
        setDraft((updated.domains ?? []).join(", "));
        toaster.success(tr("app.settings.domains.saved"));
      },
    },
    [appApi, project, instance, instances, draft, toaster, tr],
  );

  if (
    !project ||
    !instance ||
    instance.host?.type !== "bay" ||
    instance.stackEnvironmentId
  ) {
    return null;
  }

  const canManage = can("app:manage");
  const busy = saveAction.loading;
  const changed = draft.trim() !== stored;

  return (
    <SettingsRow
      htmlFor="app-settings-domains"
      label={tr("app.settings.domains.title")}
      description={tr("app.settings.domains.description")}
    >
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <Input
          id="app-settings-domains"
          className="min-w-0 flex-1 sm:w-72"
          value={draft}
          disabled={!canManage || busy}
          placeholder="app.example.com, www.example.com"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && changed) {
              void saveAction.run();
            }
          }}
        />
        {canManage ? (
          <Button
            variant="outlined"
            disabled={!changed}
            loading={busy}
            onClick={() => void saveAction.run()}
          >
            {tr("app.settings.domains.save")}
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Button variant="outlined" disabled>
                {tr("app.settings.domains.save")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{tr("app.settings.notAllowed")}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </SettingsRow>
  );
};

export default AppSettingsDomains;
