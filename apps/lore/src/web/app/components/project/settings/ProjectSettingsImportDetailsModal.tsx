import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useI18n } from "alepha/react/i18n";

import type { I18n } from "@/web/app/services/I18n.ts";

export interface ImportIssue {
  row: number;
  message: string;
}

export interface ProjectSettingsImportDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  errors: ImportIssue[];
  warnings: ImportIssue[];
}

const ProjectSettingsImportDetailsModal = (
  props: ProjectSettingsImportDetailsModalProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {tr("project.settings.data.import.details")}
          </DialogTitle>
          <DialogDescription>
            {tr("project.settings.data.title")}
          </DialogDescription>
        </DialogHeader>
        {props.errors.length > 0 && (
          <section className="flex flex-col gap-1">
            <h3 className="text-destructive text-sm font-semibold">
              Errors ({props.errors.length})
            </h3>
            <ul className="text-sm">
              {props.errors.map((e) => (
                <li key={`e-${e.row}-${e.message}`} className="border-b py-1">
                  <span className="text-muted-foreground">row {e.row}:</span>{" "}
                  {e.message}
                </li>
              ))}
            </ul>
          </section>
        )}
        {props.warnings.length > 0 && (
          <section className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">
              Warnings ({props.warnings.length})
            </h3>
            <ul className="text-sm">
              {props.warnings.map((w) => (
                <li key={`w-${w.row}-${w.message}`} className="border-b py-1">
                  <span className="text-muted-foreground">row {w.row}:</span>{" "}
                  {w.message}
                </li>
              ))}
            </ul>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ProjectSettingsImportDetailsModal;
