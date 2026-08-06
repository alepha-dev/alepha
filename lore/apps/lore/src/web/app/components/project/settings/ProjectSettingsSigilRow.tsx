import { Button } from "@alepha/ui/components/ui/button";
import { CardContent } from "@alepha/ui/components/ui/card";
import { useI18n } from "alepha/react/i18n";
import { RefreshCw, Trash2 } from "lucide-react";
import type { SigilResource } from "@/api/controllers/SigilController.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectSettingsSigilRowProps {
  sigil: SigilResource;
  onRotate: (sigil: SigilResource) => void;
  onDelete: (sigil: SigilResource) => void;
}

/**
 * One enrolled app.
 *
 * The two actions are deliberately not symmetric. Rotating replaces the token
 * and keeps everything the app has reported; deleting takes the history with
 * it, because the aggregate tables cascade. The row shows both, and the
 * confirmation each opens is where that difference is spelled out.
 */
const ProjectSettingsSigilRow = (props: ProjectSettingsSigilRowProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const sigil = props.sigil;

  return (
    <CardContent
      /*
        Marks the row as a row. The conflict message names the offending sigil
        ("A sigil already exists named …"), so counting the name across the whole
        page counts the error toast too — this is what lets a test count rows.
      */
      data-testid="sigil-row"
      className="flex flex-wrap items-center gap-3 px-4 py-3"
    >
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{sigil.name}</span>
        <code className="text-muted-foreground truncate font-mono text-xs">
          {sigil.tokenPrefix}…
        </code>
      </div>
      <span className="text-muted-foreground text-xs">
        {/*
          What an operator actually checks: not when the token was minted, but
          whether the app holding it is still reporting.
        */}
        {sigil.lastSeenAt
          ? tr("sigils.lastSeen", {
              args: [String(l(sigil.lastSeenAt, { date: "lll" }))],
            })
          : tr("sigils.neverSeen")}
      </span>
      <Button
        size="sm"
        variant="outline"
        aria-label={tr("sigils.action.rotate")}
        onClick={() => props.onRotate(sigil)}
      >
        <RefreshCw />
        {tr("sigils.action.rotate")}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="text-muted-foreground hover:text-destructive"
        aria-label={tr("sigils.action.delete")}
        onClick={() => props.onDelete(sigil)}
      >
        <Trash2 />
      </Button>
    </CardContent>
  );
};

export default ProjectSettingsSigilRow;
