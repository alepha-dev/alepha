import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@alepha/ui/components/ui/table";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { MapPin, Pencil } from "lucide-react";
import { useState } from "react";
import type { CampaignController } from "@/api/controllers/CampaignController.ts";
import { currentAssignedQuestsAtom } from "@/web/app/atoms/currentAssignedQuestsAtom.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface CampaignSettingsZonesPageProps {
  zones: ZoneRow[];
}

interface ZoneRow {
  name: string;
  questCount: number;
  firstQuestAt?: string;
}

const CampaignSettingsZonesPage = (props: CampaignSettingsZonesPageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dt = useInject(DateTimeProvider);
  const alepha = useAlepha();
  const campaignApi = useClient<CampaignController>();
  const [campaign] = useStore(currentCampaignAtom);
  const [zones, setZones] = useState<ZoneRow[]>(props.zones);
  const [renaming, setRenaming] = useState<ZoneRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!campaign) {
    return null;
  }

  const openRename = (row: ZoneRow) => {
    setRenaming(row);
    setRenameValue(row.name);
  };

  const submitRename = async () => {
    if (!renaming) return;
    const newName = renameValue.trim();
    if (!newName || newName === renaming.name) {
      setRenaming(null);
      return;
    }
    setSubmitting(true);
    try {
      await campaignApi.renameZone({
        params: { id: campaign.id },
        body: { oldZoneName: renaming.name, newZoneName: newName },
      });
      setZones((prev) =>
        prev
          .map((z) => (z.name === renaming.name ? { ...z, name: newName } : z))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      alepha.store.set(currentCampaignAtom, {
        ...campaign,
        zones: campaign.zones.map((z) => (z === renaming.name ? newName : z)),
      });
      // Keep the QuestLog (and anything else reading assigned quests) in sync:
      // rewrite the zone on every cached quest that matched the old name.
      alepha.store.set(
        currentAssignedQuestsAtom,
        (alepha.store.get(currentAssignedQuestsAtom) ?? []).map((q) =>
          q.zone === renaming.name ? { ...q, zone: newName } : q,
        ),
      );
      setRenaming(null);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <MapPin className="size-5" />
        <h2 className="text-base font-semibold">
          {tr("campaign.settings.zones.title")}
        </h2>
      </div>
      <p className="text-muted-foreground text-sm">
        {tr("campaign.settings.zones.description")}
      </p>

      <Card className="py-0 shadow">
        <CardContent className="p-0">
          {zones.length === 0 ? (
            <div className="text-muted-foreground p-6 text-center text-sm">
              {tr("campaign.settings.zones.empty")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {tr("campaign.settings.zones.column.name")}
                  </TableHead>
                  <TableHead className="w-24 text-center">
                    {tr("campaign.settings.zones.column.quests")}
                  </TableHead>
                  <TableHead className="w-40">
                    {tr("campaign.settings.zones.column.firstQuest")}
                  </TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {zones.map((z) => (
                  <TableRow key={z.name}>
                    <TableCell className="font-medium">{z.name}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{z.questCount}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {z.firstQuestAt
                        ? dt.of(z.firstQuestAt).fromNow()
                        : tr("campaign.settings.zones.never")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openRename(z)}
                      >
                        <Pencil className="size-3.5" />
                        {tr("campaign.settings.zones.rename.action")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("campaign.settings.zones.rename.title")}
            </DialogTitle>
            <DialogDescription>
              {String(
                tr("campaign.settings.zones.rename.description", [
                  renaming?.name ?? "",
                ] as never),
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="zone-rename-input">
              {tr("campaign.settings.zones.rename.label")}
            </Label>
            <Input
              id="zone-rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.currentTarget.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitRename();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRenaming(null)}
              disabled={submitting}
            >
              {tr("campaign.settings.zones.rename.cancel")}
            </Button>
            <Button onClick={() => void submitRename()} disabled={submitting}>
              {tr("campaign.settings.zones.rename.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CampaignSettingsZonesPage;
