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
import type { I18n } from "@lore/core/web";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { ProjectErrorController } from "../../../../../api/controllers/ProjectErrorController.ts";
import type { ProjectErrorRuleResource } from "../../../../../api/schemas/projectErrorRuleResourceSchema.ts";

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
  const projectErrorApi = useClient<ProjectErrorController>();
  // The rule list stays readable - it is what the inbox is filtering on - and
  // only the two writes close.
  const canManage = projectErrorApi.createProjectErrorRule.can();
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
        projectErrorApi.listProjectErrorRules({
          params: { projectId: props.projectId },
        }),
    },
    [projectErrorApi, props.projectId],
  );
  const rules = rulesQuery.data?.items ?? [];
  const loading = rulesQuery.loading && !rulesQuery.data;

  const addAction = useAction<[], void>(
    {
      handler: async () => {
        const value = pattern.trim();
        if (!value) return;
        await projectErrorApi.createProjectErrorRule({
          params: { projectId: props.projectId },
          body: { pattern: value },
        });
        setPattern("");
        toaster.success(tr("errors.rules.toast.added"));
      },
      invalidates: [["blight-rules", props.projectId]],
    },
    [projectErrorApi, pattern, props.projectId, toaster, tr],
  );

  const removeAction = useAction<[rule: ProjectErrorRuleResource], void>(
    {
      handler: async (_ctx, rule) => {
        await projectErrorApi.deleteProjectErrorRule({
          params: { projectId: props.projectId, ruleId: rule.id },
        });
        toaster.success(tr("errors.rules.toast.removed"));
      },
      invalidates: [["blight-rules", props.projectId]],
    },
    [projectErrorApi, props.projectId, toaster, tr],
  );

  // Page-wide: both writes wait while either runs.
  const saving = addAction.loading || removeAction.loading;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("errors.rules.title")}</DialogTitle>
          <DialogDescription>
            {tr("errors.rules.description")}
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
            placeholder={tr("errors.rules.placeholder")}
            onChange={(e) => setPattern(e.target.value)}
          />
          <Button
            type="submit"
            disabled={saving || !pattern.trim() || !canManage}
          >
            <Plus className="size-4" />
            {tr("errors.rules.add")}
          </Button>
        </form>

        <div className="flex max-h-[50vh] flex-col gap-1 overflow-auto">
          {loading ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              {tr("errors.rules.loading")}
            </p>
          ) : rules.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              {tr("errors.rules.empty")}
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
                  variant="minimal"
                  size="icon"
                  className="text-danger-text shrink-0"
                  disabled={saving || !canManage}
                  onClick={() => void removeAction.run(rule)}
                  aria-label={tr("errors.rules.remove")}
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
