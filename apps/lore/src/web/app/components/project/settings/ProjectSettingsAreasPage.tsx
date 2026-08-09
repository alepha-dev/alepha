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
import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import { currentAssignedQuestsAtom } from "@/web/app/atoms/currentAssignedQuestsAtom.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectSettingsAreasPageProps {
  areas: AreaRow[];
}

interface AreaRow {
  name: string;
  questCount: number;
  firstQuestAt?: string;
}

const ProjectSettingsAreasPage = (props: ProjectSettingsAreasPageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dt = useInject(DateTimeProvider);
  const alepha = useAlepha();
  const projectApi = useClient<ProjectController>();
  const [project] = useStore(currentProjectAtom);
  const [areas, setAreas] = useState<AreaRow[]>(props.areas);
  const [renaming, setRenaming] = useState<AreaRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!project) {
    return null;
  }

  const openRename = (row: AreaRow) => {
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
      await projectApi.renameArea({
        params: { id: project.id },
        body: { oldAreaName: renaming.name, newAreaName: newName },
      });
      setAreas((prev) =>
        prev
          .map((z) => (z.name === renaming.name ? { ...z, name: newName } : z))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      alepha.store.set(currentProjectAtom, {
        ...project,
        areas: project.areas.map((z) => (z === renaming.name ? newName : z)),
      });
      // Keep the QuestLog (and anything else reading assigned quests) in sync:
      // rewrite the area on every cached quest that matched the old name.
      alepha.store.set(
        currentAssignedQuestsAtom,
        (alepha.store.get(currentAssignedQuestsAtom) ?? []).map((q) =>
          q.area === renaming.name ? { ...q, area: newName } : q,
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
          {tr("project.settings.areas.title")}
        </h2>
      </div>
      <p className="text-muted-foreground text-sm">
        {tr("project.settings.areas.description")}
      </p>

      <Card className="py-0 shadow">
        <CardContent className="p-0">
          {areas.length === 0 ? (
            <div className="text-muted-foreground p-6 text-center text-sm">
              {tr("project.settings.areas.empty")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {tr("project.settings.areas.column.name")}
                  </TableHead>
                  <TableHead className="w-24 text-center">
                    {tr("project.settings.areas.column.quests")}
                  </TableHead>
                  <TableHead className="w-40">
                    {tr("project.settings.areas.column.firstQuest")}
                  </TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {areas.map((z) => (
                  <TableRow key={z.name}>
                    <TableCell className="font-medium">{z.name}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{z.questCount}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {z.firstQuestAt
                        ? dt.of(z.firstQuestAt).fromNow()
                        : tr("project.settings.areas.never")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openRename(z)}
                      >
                        <Pencil className="size-3.5" />
                        {tr("project.settings.areas.rename.action")}
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
              {tr("project.settings.areas.rename.title")}
            </DialogTitle>
            <DialogDescription>
              {String(
                tr("project.settings.areas.rename.description", [
                  renaming?.name ?? "",
                ] as never),
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="area-rename-input">
              {tr("project.settings.areas.rename.label")}
            </Label>
            <Input
              id="area-rename-input"
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
              {tr("project.settings.areas.rename.cancel")}
            </Button>
            <Button onClick={() => void submitRename()} disabled={submitting}>
              {tr("project.settings.areas.rename.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectSettingsAreasPage;
