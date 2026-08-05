import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { CardContent } from "@alepha/ui/components/ui/card";
import { useI18n } from "alepha/react/i18n";
import { RefreshCw, Trash2 } from "lucide-react";
import type { OutpostResource } from "@/api/controllers/OutpostController.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectSettingsOutpostRowProps {
  outpost: OutpostResource;
  onRotate: (outpost: OutpostResource) => void;
  onDelete: (outpost: OutpostResource) => void;
}

/**
 * One enrolled machine.
 *
 * The two actions are deliberately not symmetric. Rotating replaces the token
 * and keeps everything the machine has reported; deleting takes its hosted
 * applications and deploy history with it, because both cascade on
 * `outpostId`. The row shows both, and the confirmation each opens is where
 * that difference is spelled out.
 */
const ProjectSettingsOutpostRow = (props: ProjectSettingsOutpostRowProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const outpost = props.outpost;

  return (
    <CardContent className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{outpost.label}</span>
          {outpost.agent && <Badge variant="secondary">{outpost.agent}</Badge>}
        </div>
        <code className="text-muted-foreground truncate font-mono text-xs">
          {outpost.tokenPrefix}…
        </code>
      </div>
      <span className="text-muted-foreground text-xs">
        {/*
          What an operator actually checks: not when the token was minted, but
          whether the machine holding it is still reporting.
        */}
        {outpost.lastSeenAt
          ? tr("outposts.lastSeen", {
              args: [String(l(outpost.lastSeenAt, { date: "lll" }))],
            })
          : tr("outposts.neverSeen")}
      </span>
      <Button
        size="sm"
        variant="outline"
        aria-label={tr("outposts.action.rotate")}
        onClick={() => props.onRotate(outpost)}
      >
        <RefreshCw />
        {tr("outposts.action.rotate")}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="text-muted-foreground hover:text-destructive"
        aria-label={tr("outposts.action.delete")}
        onClick={() => props.onDelete(outpost)}
      >
        <Trash2 />
      </Button>
    </CardContent>
  );
};

export default ProjectSettingsOutpostRow;
