import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";

import type { AutomationCatalogNodeType } from "../../../../../../api/schemas/automationCatalogNodeTypeSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";
import { useAutomationLabels } from "../useAutomationLabels.ts";

/**
 * One entry of the palette: a node type, and why it cannot be added here
 * when it cannot.
 */
export interface AutomationPaletteEntry {
  nodeType: AutomationCatalogNodeType;
  reason?: string;
}

export interface AutomationNodePaletteProps {
  open: boolean;
  /**
   * The node a picked entry is wired from, for the title; absent, the
   * palette adds a free node.
   */
  after?: string;
  entries: AutomationPaletteEntry[];
  onPick: (nodeType: AutomationCatalogNodeType) => void;
  onClose: () => void;
}

/**
 * What can be added to the graph (#Q3811), grouped as sources, reads,
 * conditions and actions: what the catalog allows this author in this
 * project, an unavailable entry disabled with its reason, as the form said.
 */
const AutomationNodePalette = (props: AutomationNodePaletteProps) => {
  const { tr } = useI18n<I18n, "en">();
  const labels = useAutomationLabels();
  const groups: Array<{ kind: string; title: string }> = [
    { kind: "source", title: tr("automation.canvas.group.sources") },
    { kind: "read", title: tr("automation.canvas.group.reads") },
    { kind: "condition", title: tr("automation.canvas.group.conditions") },
    { kind: "action", title: tr("automation.canvas.group.actions") },
  ];
  const name = (nodeType: AutomationCatalogNodeType) =>
    nodeType.kind === "source"
      ? nodeType.type === "schedule"
        ? tr("automation.canvas.schedule")
        : labels.source({
            id: nodeType.type,
            kind: "source",
            type: nodeType.type,
            config: {},
          })
      : nodeType.kind === "condition"
        ? tr("automation.canvas.compare")
        : nodeType.kind === "action"
          ? tr(`automation.action.${nodeType.type}`, { default: nodeType.type })
          : tr(`automation.source.${nodeType.type}`, {
              default: nodeType.type,
            });
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent
        className="max-h-[80vh] overflow-y-auto"
        data-testid="automation-node-palette"
      >
        <DialogHeader>
          <DialogTitle>
            {props.after
              ? tr("automation.canvas.palette.after", { args: [props.after] })
              : tr("automation.canvas.palette.title")}
          </DialogTitle>
          <DialogDescription>
            {tr("automation.canvas.palette.description")}
          </DialogDescription>
        </DialogHeader>
        {groups.map((group) => {
          const entries = props.entries.filter(
            (entry) => entry.nodeType.kind === group.kind,
          );
          if (!entries.length) return null;
          return (
            <section key={group.kind} className="flex flex-col gap-1.5">
              <h3 className="text-muted-foreground text-xs font-medium uppercase">
                {group.title}
              </h3>
              <div className="flex flex-col gap-1">
                {entries.map((entry) => (
                  <Button
                    key={entry.nodeType.type}
                    variant="outlined"
                    className="h-auto justify-start py-2 text-start whitespace-normal"
                    disabled={!!entry.reason}
                    data-testid={`automation-palette-${entry.nodeType.type}`}
                    onClick={() => props.onPick(entry.nodeType)}
                  >
                    <span className="flex flex-col items-start">
                      <span>{name(entry.nodeType)}</span>
                      {entry.reason && (
                        <span className="text-muted-foreground text-xs">
                          {entry.reason}
                        </span>
                      )}
                    </span>
                  </Button>
                ))}
              </div>
            </section>
          );
        })}
      </DialogContent>
    </Dialog>
  );
};

export default AutomationNodePalette;
