import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

export interface AppDeployLogDialogProps {
  /**
   * The run whose log is shown, or undefined when the dialog is closed. Read
   * from the history on every render, so a run still moving keeps writing
   * into an open dialog as the history polls.
   */
  run?: Record<string, any>;
  onClose: () => void;
}

/**
 * One run's log, in a dialog over the history.
 *
 * The log is Lore's own `deployments` row, not a container's buffer, so it
 * survives a Worker restart and reads the same after the run as during it.
 */
const AppDeployLogDialog = (props: AppDeployLogDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const log = (props.run?.log ?? []) as Array<{ at: string; text: string }>;

  return (
    <Dialog
      open={!!props.run}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl" data-testid="app-deploy-log">
        <DialogHeader>
          <DialogTitle>
            {tr("app.deploy.log.title", { args: [String(props.run?.tag)] })}
          </DialogTitle>
          {props.run?.error ? (
            <DialogDescription className="text-danger-text">
              {String(props.run.error)}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {log.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {tr("app.deploy.log.empty")}
          </p>
        ) : (
          <pre className="bg-muted/50 max-h-[60vh] overflow-auto rounded-md p-3 font-mono text-xs">
            {log.map((line) => line.text).join("\n")}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AppDeployLogDialog;
