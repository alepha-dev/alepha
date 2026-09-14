import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  useToast,
} from "@alepha/ui";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { BlightController } from "@/api/controllers/BlightController.ts";
import type { BlightRuleResource } from "@/api/schemas/blightRuleResourceSchema.ts";

import type { I18n } from "../../../services/I18n.ts";

export interface ProjectBlightRulesDialogProps {
  open: boolean;
  projectId: number;
  onOpenChange: (open: boolean) => void;
}

/**
 * Owner-facing manager for a project's blight ignore rules — the message
 * substrings that drop matching crashes at ingestion. Lists existing rules,
 * adds a new one, and removes one. Rules are future-only: adding a rule mutes
 * new ingest but leaves rows already captured (clear those with the inbox's
 * mass-delete selection).
 */
const ProjectBlightRulesDialog = (props: ProjectBlightRulesDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const blightApi = useClient<BlightController>();
  // The rule list stays readable - it is what the inbox is filtering on - and
  // only the two writes close.
  const canManage = blightApi.createBlightRule.can();
  const toaster = useToast();

  const [pattern, setPattern] = useState("");

  // Clear the input on the closed → open transition. During render, so the
  // dialog never shows the previous session's pattern.
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) {
      setPattern("");
    }
  }

  // Re-read every time the dialog opens: `enabled` follows `open`, and with no
  // `staleTime` a cached list never skips the read (#E59, #Q2329). Keyed, so
  // the two writes below refresh it through `invalidates`. A failed read is
  // toasted by the root `ActionErrorToaster`.
  const rulesQuery = useQuery(
    {
      key: ["blight-rules", props.projectId],
      enabled: props.open,
      keepPreviousData: true,
      handler: () =>
        blightApi.listBlightRules({ params: { projectId: props.projectId } }),
    },
    [blightApi, props.projectId],
  );
  const rules = rulesQuery.data?.items ?? [];
  const loading = rulesQuery.loading && !rulesQuery.data;

  const addAction = useAction<[], void>(
    {
      handler: async () => {
        const value = pattern.trim();
        if (!value) return;
        await blightApi.createBlightRule({
          params: { projectId: props.projectId },
          body: { pattern: value },
        });
        setPattern("");
        toaster.success(tr("blights.rules.toast.added"));
      },
      invalidates: [["blight-rules", props.projectId]],
    },
    [blightApi, pattern, props.projectId, toaster, tr],
  );

  const removeAction = useAction<[rule: BlightRuleResource], void>(
    {
      handler: async (rule) => {
        await blightApi.deleteBlightRule({
          params: { projectId: props.projectId, ruleId: rule.id },
        });
        toaster.success(tr("blights.rules.toast.removed"));
      },
      invalidates: [["blight-rules", props.projectId]],
    },
    [blightApi, props.projectId, toaster, tr],
  );

  // Page-wide: both writes wait while either runs.
  const saving = addAction.loading || removeAction.loading;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("blights.rules.title")}</DialogTitle>
          <DialogDescription>
            {tr("blights.rules.description")}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void addAction.run();
          }}
        >
          <Input
            value={pattern}
            placeholder={tr("blights.rules.placeholder")}
            onChange={(e) => setPattern(e.target.value)}
          />
          <Button
            type="submit"
            disabled={saving || !pattern.trim() || !canManage}
          >
            <Plus className="size-4" />
            {tr("blights.rules.add")}
          </Button>
        </form>

        <div className="flex max-h-[50vh] flex-col gap-1 overflow-auto">
          {loading ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              {tr("blights.rules.loading")}
            </p>
          ) : rules.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              {tr("blights.rules.empty")}
            </p>
          ) : (
            rules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                {/* Owner-authored — plain text, escaped by React. */}
                <span className="font-mono text-sm break-all">
                  {rule.pattern}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive shrink-0"
                  disabled={saving || !canManage}
                  onClick={() => void removeAction.run(rule)}
                  aria-label={tr("blights.rules.remove")}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProjectBlightRulesDialog;
