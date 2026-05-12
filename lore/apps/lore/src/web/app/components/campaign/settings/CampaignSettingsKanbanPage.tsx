import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { CampaignController } from "@/api/controllers/CampaignController.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import { userCampaignsAtom } from "@/web/app/atoms/userCampaignsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import CampaignSettingsFeatureSection from "./CampaignSettingsFeatureSection.tsx";
import { useCampaignFeatureToggle } from "./useCampaignFeatureToggle.ts";

const MAX_COLUMNS = 5;

const CampaignSettingsKanbanPage = () => {
  const { enabled, toggle } = useCampaignFeatureToggle("kanban");
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const campaignApi = useClient<CampaignController>();
  const [campaign] = useStore(currentCampaignAtom);

  const persisted = campaign?.kanbanColumns ?? ["In Progress"];
  const [columns, setColumns] = useState<string[]>(persisted);
  const [pending, setPending] = useState<string | null>(null);

  // Reset local state when the campaign changes underneath (switching pages /
  // navigating to a different campaign).
  if (campaign && columns !== persisted && pending === null) {
    // Only reset if the stored value diverged from local AND we don't have a
    // pending request — avoids fighting the user mid-edit.
    if (JSON.stringify(persisted) !== JSON.stringify(columns)) {
      // no-op; user is editing
    }
  }

  if (!campaign) return null;

  const syncCampaign = (next: string[]) => {
    const updated = { ...campaign, kanbanColumns: next };
    alepha.store.set(currentCampaignAtom, updated);
    alepha.store.set(userCampaignsAtom, [
      ...(alepha.store.get(userCampaignsAtom) ?? []).filter(
        (c) => c.id !== updated.id,
      ),
      updated,
    ]);
  };

  const runOp = async (label: string, fn: () => Promise<string[]>) => {
    setPending(label);
    try {
      const next = await fn();
      setColumns(next);
      syncCampaign(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(null);
    }
  };

  const handleAdd = () =>
    runOp("add", () =>
      campaignApi.addKanbanColumn({
        params: { id: campaign.id },
        body: { name: `Column ${columns.length + 1}` },
      }),
    );

  const handleRename = (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    return runOp(`rename:${oldName}`, () =>
      campaignApi.renameKanbanColumn({
        params: { id: campaign.id },
        body: { oldName, newName: trimmed },
      }),
    );
  };

  const handleDelete = (name: string) =>
    runOp(`delete:${name}`, () =>
      campaignApi.deleteKanbanColumn({
        params: { id: campaign.id },
        body: { name },
      }),
    );

  return (
    <div className="flex flex-col gap-4">
      <CampaignSettingsFeatureSection
        featureKey="kanban"
        enabled={enabled}
        onToggle={toggle}
      />

      {enabled && (
        <Card className="py-4 shadow">
          <CardContent className="flex flex-col gap-3 px-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                {tr("campaign.settings.kanban.columns.title")}
              </span>
              <span className="text-muted-foreground text-xs">
                {tr("campaign.settings.kanban.columns.description")}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {columns.map((col) => (
                <ColumnRow
                  key={col}
                  name={col}
                  disabled={pending !== null}
                  onRename={(newName) => handleRename(col, newName)}
                  onDelete={() => handleDelete(col)}
                />
              ))}
            </div>

            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={columns.length >= MAX_COLUMNS || pending !== null}
                onClick={handleAdd}
              >
                <Plus className="size-3.5" />
                {tr("campaign.settings.kanban.columns.add")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

interface ColumnRowProps {
  name: string;
  disabled: boolean;
  onRename: (next: string) => void;
  onDelete: () => void;
}

const ColumnRow = (props: ColumnRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [value, setValue] = useState(props.name);

  return (
    <div className="border-border bg-muted/30 flex items-center gap-2 rounded-md border px-2 py-1.5">
      <GripVertical className="text-muted-foreground size-4 shrink-0" />
      <Input
        value={value}
        disabled={props.disabled}
        onChange={(e) => setValue(e.currentTarget.value)}
        onBlur={() => {
          if (value !== props.name) props.onRename(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setValue(props.name);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        placeholder={String(tr("campaign.settings.kanban.columns.placeholder"))}
        className="h-8 flex-1 text-sm"
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={props.disabled}
        onClick={props.onDelete}
        aria-label={String(tr("campaign.settings.kanban.columns.delete"))}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
};

export default CampaignSettingsKanbanPage;
