import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { Segmented } from "@alepha/ui/components/ui/segmented";
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

type FeedbackPosition = "bottom-right" | "bottom-left";

/**
 * Which corner this app's feedback button sits in.
 *
 * Its own card rather than a row inside Capabilities: that card answers "what
 * may this app report", and a placement is not a capability. It is also the
 * only setting here that changes what the app's *visitors* see.
 *
 * The value ships to third-party pages through `/sigils/config`, which the
 * reporting client already polls — so this costs no extra request and no extra
 * query. It reaches a `style` there, so the client narrows it back to a known
 * corner rather than trusting the string.
 *
 * Owner-only server-side, like every other mutation on this page; the control
 * is disabled for a non-owner as a UX hint over `currentProjectMemberAtom`, not
 * as a second authorization boundary.
 */
const AppSettingsFeedbackPosition = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const sigilApi = useClient<SigilController>();

  const [project] = useStore(currentProjectAtom);
  const [member] = useStore(currentProjectMemberAtom);
  const [sigil, setSigil] = useStore(currentSigilAtom);
  const [sigils, setSigils] = useStore(currentSigilsAtom);
  const [busy, setBusy] = useState(false);

  const isOwner = member?.owner ?? false;

  if (!project || !sigil) {
    return null;
  }

  // The card is about the feedback button, so it has nothing to say for an app
  // that cannot show one.
  if (!sigil.kinds.includes("feedback")) {
    return null;
  }

  const current: FeedbackPosition =
    sigil.feedbackPosition === "bottom-left" ? "bottom-left" : "bottom-right";

  const options = [
    {
      value: "bottom-left",
      label: String(tr("app.settings.feedbackPosition.bottomLeft")),
    },
    {
      value: "bottom-right",
      label: String(tr("app.settings.feedbackPosition.bottomRight")),
    },
  ];

  const select = async (value: string) => {
    if (value === current) {
      return;
    }

    setBusy(true);
    try {
      const updated = await sigilApi.updateSigil({
        params: { projectId: project.id, sigilId: sigil.id },
        // `kinds` omitted on purpose — the endpoint treats an absent key as
        // "leave it alone", so this control cannot clobber the capabilities
        // card's state with a stale copy of it.
        body: { feedbackPosition: value as FeedbackPosition },
      });
      setSigil(updated);
      setSigils(
        (sigils ?? []).map((it) => (it.id === updated.id ? updated : it)),
      );
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {tr("app.settings.feedbackPosition.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground text-sm">
          {tr("app.settings.feedbackPosition.description")}
        </p>
        {isOwner ? (
          <Segmented
            options={options}
            value={current}
            disabled={busy}
            size="sm"
            onChange={(value) => {
              void select(value);
            }}
          />
        ) : (
          // Wrapped in a span rather than handed to `render`: a disabled
          // control swallows the pointer events the tooltip listens for.
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Segmented options={options} value={current} disabled size="sm" />
            </TooltipTrigger>
            <TooltipContent>{tr("app.settings.ownerOnly")}</TooltipContent>
          </Tooltip>
        )}
      </CardContent>
    </Card>
  );
};

export default AppSettingsFeedbackPosition;
