import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { X } from "lucide-react";
import type { Folio } from "@/api/entities/folios.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import EpicFolioPicker from "./EpicFolioPicker.tsx";

export interface ProjectEpicFoliosProps {
  projectId: number;
  projectSlug: string;
  folios: Folio[];
  onAttach: (folioId: string) => void;
  onDetach: (folio: Folio) => void;
}

/**
 * Zone 3 of the Epic page: the attached folios, with a picker to attach
 * more. Detach goes through the parent's `useDialog().confirm(...)` — this
 * component only reports the intent.
 */
const ProjectEpicFolios = (props: ProjectEpicFoliosProps) => {
  const { tr } = useI18n<I18n, "en">();
  const attachedIds = new Set(props.folios.map((f) => f.id));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{tr("epic.folios.title")}</CardTitle>
        <EpicFolioPicker
          projectId={props.projectId}
          attachedIds={attachedIds}
          onAttach={props.onAttach}
        />
      </CardHeader>
      <CardContent>
        {props.folios.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            {tr("epic.folios.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {props.folios.map((folio) => (
              <li
                key={folio.id}
                className="hover:bg-muted/40 flex items-center justify-between gap-2 rounded px-2 py-1"
              >
                <Link
                  href={`/${props.projectSlug}/folios/${folio.shortId}`}
                  className="min-w-0 flex-1 truncate text-sm hover:underline"
                >
                  {folio.title}
                </Link>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 shrink-0 p-0"
                  aria-label={tr("epic.folios.detach")}
                  onClick={() => props.onDetach(folio)}
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

export default ProjectEpicFolios;
