import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { Progress } from "@alepha/ui/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@alepha/ui/components/ui/table";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { EpicController } from "@/api/controllers/EpicController.ts";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import { STATUS_BADGE_VARIANT, STATUS_LABEL_KEYS } from "./epicStatus.ts";

export interface ProjectEpicsProps {
  epics: EpicResource[];
}

/**
 * The Epics list — number, title, status and progress. A Create button
 * opens a dialog for title + description; new epics always start
 * `planned` (see `EpicController.createEpic`).
 *
 * Status is a read-only badge here. Changing it is the Epic detail page's
 * job (`EpicStatusControl.tsx`) — this list intentionally does not
 * duplicate that control or its transition-verb vocabulary.
 *
 * Each row's title links to `projectEpic` (`/epics/:epicNumber`), the
 * detail page.
 */
const ProjectEpics = (props: ProjectEpicsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const router = useRouter<AppRouter>();
  const epicApi = useClient<EpicController>();
  const [project] = useStore(currentProjectAtom);

  const [epics, setEpics] = useState<EpicResource[]>(props.epics);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!project) {
    return null;
  }

  const openCreate = () => {
    setTitle("");
    setDescription("");
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const created = await epicApi.createEpic({
        params: { projectId: project.id },
        body: {
          title: trimmed,
          description: description.trim() || undefined,
        },
      });
      setEpics((prev) =>
        [...prev, created].sort((a, b) => a.number - b.number),
      );
      setCreateOpen(false);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{tr("project.menu.epics")}</h2>
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          {tr("epic.create")}
        </Button>
      </div>

      <Card className="py-0 shadow">
        <CardContent className="p-0">
          {epics.length === 0 ? (
            <div className="text-muted-foreground p-6 text-center text-sm">
              {tr("epic.list.empty")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">
                    {tr("epic.list.column.number")}
                  </TableHead>
                  <TableHead>{tr("epic.list.column.title")}</TableHead>
                  <TableHead className="w-32">
                    {tr("epic.list.column.status")}
                  </TableHead>
                  <TableHead className="w-48">
                    {tr("epic.list.column.progress")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {epics.map((epic) => {
                  const pct =
                    epic.progress.total > 0
                      ? Math.round(
                          (epic.progress.completed / epic.progress.total) * 100,
                        )
                      : 0;
                  return (
                    <TableRow key={epic.id}>
                      <TableCell className="text-muted-foreground">
                        #{epic.number}
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link
                          href={router.path("projectEpic", {
                            params: { epicNumber: epic.number },
                          })}
                          className="hover:underline"
                        >
                          {epic.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGE_VARIANT[epic.status]}>
                          {tr(STATUS_LABEL_KEYS[epic.status])}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={pct} className="w-24" />
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {epic.progress.completed}/{epic.progress.total}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("epic.create")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="epic-create-title">
                {tr("epic.create.title.label")}
              </Label>
              <Input
                id="epic-create-title"
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                placeholder={tr("epic.create.title.placeholder")}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="epic-create-description">
                {tr("epic.create.description.label")}
              </Label>
              <Textarea
                id="epic-create-description"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.currentTarget.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={submitting}
            >
              {tr("epic.create.cancel")}
            </Button>
            <Button
              onClick={() => void submitCreate()}
              disabled={submitting || !title.trim()}
            >
              {tr("epic.create.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectEpics;
