import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  BlightController,
  BlightRuleResource,
} from "@/api/controllers/BlightController.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface CampaignBlightRulesDialogProps {
  open: boolean;
  campaignId: number;
  onOpenChange: (open: boolean) => void;
}

/**
 * Owner-facing manager for a campaign's blight ignore rules — the message
 * substrings that drop matching crashes at ingestion. Lists existing rules,
 * adds a new one, and removes one. Rules are future-only: adding a rule mutes
 * new ingest but leaves rows already captured (clear those with the inbox's
 * mass-delete selection).
 */
const CampaignBlightRulesDialog = (props: CampaignBlightRulesDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const blightApi = useClient<BlightController>();
  const toaster = useToast();

  const [rules, setRules] = useState<BlightRuleResource[]>([]);
  const [pattern, setPattern] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await blightApi.listBlightRules({
        params: { campaignId: props.campaignId },
      });
      setRules(res.items);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  // Reload the rule list every time the dialog opens, and reset the input.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open + campaign id are the only relevant deps
  useEffect(() => {
    if (!props.open) return;
    setPattern("");
    void load();
  }, [props.open, props.campaignId]);

  const add = async () => {
    const value = pattern.trim();
    if (!value) return;
    setSaving(true);
    try {
      const created = await blightApi.createBlightRule({
        params: { campaignId: props.campaignId },
        body: { pattern: value },
      });
      setRules((prev) => [created, ...prev]);
      setPattern("");
      toaster.success(tr("blights.rules.toast.added"));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (rule: BlightRuleResource) => {
    try {
      await blightApi.deleteBlightRule({
        params: { campaignId: props.campaignId, ruleId: rule.id },
      });
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
      toaster.success(tr("blights.rules.toast.removed"));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

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
            void add();
          }}
        >
          <Input
            value={pattern}
            placeholder={tr("blights.rules.placeholder")}
            onChange={(e) => setPattern(e.target.value)}
            autoFocus
          />
          <Button type="submit" disabled={saving || !pattern.trim()}>
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
                <span className="break-all font-mono text-sm">
                  {rule.pattern}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive shrink-0"
                  onClick={() => void remove(rule)}
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

export default CampaignBlightRulesDialog;
