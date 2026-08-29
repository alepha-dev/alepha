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

import type { SigilController } from "@/api/controllers/SigilController.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "../../../atoms/currentProjectMemberAtom.ts";
import { currentSigilAtom } from "../../../atoms/currentSigilAtom.ts";
import { currentSigilsAtom } from "../../../atoms/currentSigilsAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

/**
 * Where this app lives, when the address it reports from is not the one to
 * show.
 *
 * The field is an **override, not a setting**, and the empty state is what
 * says so: the placeholder is the host the app last reported from, so a blank
 * field reads as "using what the app reports" rather than as "unset". That is
 * also why clearing it is a real operation rather than an omission - it is the
 * way back to the detected address.
 *
 * It exists because detection cannot be right for everyone. An app on both an
 * apex and a `www` reports whichever served the last batch; an app enrolled
 * only for Feedback never posts to the ingest and so reports nothing at all.
 * Neither is a detection bug - they are the cases where only the operator
 * knows the canonical answer.
 *
 * Owner-only server-side, like every other mutation on this page; the control
 * is disabled for a non-owner as a UX hint over `currentProjectMemberAtom`,
 * not as a second authorization boundary.
 */
const AppSettingsUrl = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const sigilApi = useClient<SigilController>();

  const [project] = useStore(currentProjectAtom);
  const [member] = useStore(currentProjectMemberAtom);
  const [sigil, setSigil] = useStore(currentSigilAtom);
  const [sigils, setSigils] = useStore(currentSigilsAtom);

  /**
   * Seeded once, on purpose. Re-seeding from the atom on every render would
   * fight whoever is typing the moment any other card on this page PATCHes and
   * writes a fresh sigil back.
   */
  const [draft, setDraft] = useState(sigil?.url ?? "");
  const [busy, setBusy] = useState(false);

  const isOwner = member?.owner ?? false;

  if (!project || !sigil) {
    return null;
  }

  const save = async () => {
    if (draft.trim() === (sigil.url ?? "")) {
      return;
    }

    setBusy(true);
    try {
      const updated = await sigilApi.updateSigil({
        params: { projectId: project.id, sigilId: sigil.id },
        // `kinds` omitted on purpose — the endpoint treats an absent key as
        // "leave it alone", so this control cannot clobber the capabilities
        // card's state with a stale copy of it.
        body: { url: draft.trim() },
      });
      setSigil(updated);
      setSigils(
        (sigils ?? []).map((it) => (it.id === updated.id ? updated : it)),
      );
      // Back from the server rather than from the draft: `readUrl` normalizes,
      // so what was typed and what was stored are not always the same string.
      setDraft(updated.url ?? "");
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
        sigil.lastSeenHost
          ? tr("app.settings.url.detected", { args: [sigil.lastSeenHost] })
          : tr("app.settings.url.description")
      }
    >
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <Input
          id="app-settings-url"
          type="url"
          className="min-w-0 flex-1 sm:w-72"
          // The detected host, so an empty field reads as "using this one"
          // rather than as a blank nobody filled in.
          placeholder={
            sigil.lastSeenHost
              ? `https://${sigil.lastSeenHost}`
              : "https://example.com"
          }
          value={draft}
          disabled={!isOwner || busy}
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
            disabled={busy || draft.trim() === (sigil.url ?? "")}
            onClick={() => void save()}
          >
            {tr("app.settings.url.save")}
          </Button>
        ) : (
          // Wrapped in a span rather than handed to `render`: a disabled
          // control swallows the pointer events the tooltip listens for.
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
