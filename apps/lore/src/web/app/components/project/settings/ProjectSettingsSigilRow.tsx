import { CardContent } from "@alepha/ui/components/ui/card";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { ChevronRight } from "lucide-react";
import type { SigilResource } from "@/api/controllers/SigilController.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectSettingsSigilRowProps {
  sigil: SigilResource;
}

/**
 * One enrolled app, as the inventory lists it.
 *
 * The row is a link, not a control surface. Rotating and deleting are per-app
 * actions and live on that app's own Settings tab — keeping a delete button
 * here as well would give an irreversible action that erases everything the app
 * ever reported two front doors, on a page whose job is enrolment.
 */
const ProjectSettingsSigilRow = (props: ProjectSettingsSigilRowProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const sigil = props.sigil;

  return (
    <CardContent
      /*
        Marks the row as a row. The conflict message names the offending sigil
        ("A sigil already exists named …"), so counting the name across the whole
        page counts the error toast too — this is what lets a test count rows.
      */
      data-testid="sigil-row"
      className="p-0"
    >
      <Link
        href={router.path("app", {
          params: {
            projectId: String(sigil.projectId),
            appName: sigil.name,
          },
        })}
        className="hover:bg-muted/60 flex flex-wrap items-center gap-3 px-4 py-3 transition-colors"
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
        <ChevronRight className="text-muted-foreground size-4 shrink-0" />
      </Link>
    </CardContent>
  );
};

export default ProjectSettingsSigilRow;
