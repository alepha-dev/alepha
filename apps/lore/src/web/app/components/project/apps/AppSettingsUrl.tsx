import { SettingsRow } from "@alepha/ui/components/settings/settings-row";
import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { AppController } from "@/api/controllers/AppController.ts";

import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "../../../atoms/currentProjectMemberAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

/**
 * Where this deployed copy lives, as the operator pinned it.
 *
 * **The empty field is load-bearing.** Its placeholder is the host the copy
 * last reported from, so blank reads as "using what the app reports" rather
 * than as "unset", and clearing it is a real operation: `updateApp` treats `""`
 * as "clear" and every other absent key as "leave alone". With omission as the
 * only "no", an operator who pinned the wrong address could never get back to
 * the detected one.
 *
 * An instance with no sigil has no detected host at all - nothing has reported
 * - so the placeholder falls back to an example and the description says the
 * address is unknown until one is pinned or reported.
 *
 * ⚠️ **Key this by `instance.id` wherever it is mounted.** Moving between two
 * instances' Settings tabs swaps `currentInstanceAtom` without unmounting
 * anything, so an unkeyed draft would keep showing - and on Save, write - the
 * URL of the instance you just left. `SettingsRow` does not unmount it for you.
 */
const AppSettingsUrl = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const appApi = useClient<AppController>();

  const [project] = useStore(currentProjectAtom);
  const [member] = useStore(currentProjectMemberAtom);
  const [instance, setInstance] = useStore(currentInstanceAtom);
  const [instances, setInstances] = useStore(currentInstancesAtom);

  /**
   * Seeded once. Re-seeding from the atom on every render would fight whoever
   * is typing the moment any other row on this page PATCHes and writes a fresh
   * instance back.
   */
  const [draft, setDraft] = useState(instance?.url ?? "");
  const [busy, setBusy] = useState(false);

  if (!project || !instance) {
    return null;
  }

  const isOwner = member?.owner ?? false;
  const detected = instance.sigil?.lastSeenHost;
  const changed = draft.trim() !== (instance.url ?? "");

  const save = async () => {
    if (!changed) {
      return;
    }

    setBusy(true);
    try {
      const updated = await appApi.updateApp({
        params: {
          projectId: project.id,
          app: instance.app,
          env: instance.env,
        },
        body: { url: draft.trim() },
      });
      setInstance(updated);
      setInstances(
        (instances ?? []).map((it) => (it.id === updated.id ? updated : it)),
      );
      // Back from the server: a bare origin loses its trailing slash on the
      // way in, so what was typed and what was stored are not the same string.
      setDraft(updated.url ?? "");
      toaster.success(tr("app.settings.url.saved"));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsRow
      htmlFor="app-settings-url"
      label={tr("app.settings.url.title")}
      description={
        detected
          ? tr("app.settings.url.detected", { args: [detected] })
          : tr("app.settings.url.description")
      }
    >
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <Input
          id="app-settings-url"
          className="min-w-0 flex-1 sm:w-72"
          value={draft}
          disabled={!isOwner || busy}
          placeholder={detected ? `https://${detected}` : "https://example.com"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void save();
            }
          }}
        />
        {isOwner ? (
          <Button
            variant="outline"
            disabled={busy || !changed}
            onClick={() => void save()}
          >
            {tr("app.settings.url.save")}
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Button variant="outline" disabled>
                {tr("app.settings.url.save")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{tr("app.settings.ownerOnly")}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </SettingsRow>
  );
};

export default AppSettingsUrl;
