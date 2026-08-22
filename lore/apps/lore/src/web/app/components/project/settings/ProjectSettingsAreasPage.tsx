import { settingsCardEdge } from "@alepha/ui/components/settings/settings-card-edge.ts";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@alepha/ui/components/ui/table";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { HttpError } from "alepha/server";
import { MapPin } from "lucide-react";
import { useState } from "react";

import type { AreaController } from "@/api/controllers/AreaController.ts";
import type { AreaResource } from "@/api/schemas/areaResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { descriptionSnippet } from "@/web/app/services/descriptionSnippet.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import AreaMergeDialog from "./AreaMergeDialog.tsx";

export interface ProjectSettingsAreasPageProps {
  areas: AreaResource[];
}

/**
 * Areas settings list: real per-area stats, multi-select, and the bulk
 * merge toolbar that is the whole point of this rework. Renaming a
 * single area (and merging by rename-onto-collision) lives on the
 * detail page (`projectSettingsArea`) now; this page's job is
 * navigation, stats, bulk merge, and deleting areas that hold no quests.
 */
const ProjectSettingsAreasPage = (props: ProjectSettingsAreasPageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const dt = useInject(DateTimeProvider);
  const router = useRouter<AppRouter>();
  const areaApi = useClient<AreaController>();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [merging, setMerging] = useState(false);

  const reload = async () => {
    setSelected(new Set());
    await router.push(router.pathname, { force: true });
  };

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const remove = async (area: AreaResource) => {
    const ok = await dialog.confirm({
      title: String(tr("project.settings.areas.delete.confirm")),
      destructive: true,
    });
    if (!ok) return;
    try {
      await areaApi.deleteArea({ params: { id: area.id } });
      await reload();
    } catch (error) {
      // The row only offers this button when the loader's snapshot showed
      // `questCount === 0`, but a quest can land here between that read
      // and this click (another tab, another member). The server's own
      // refusal is authoritative; show its friendlier localized wording
      // instead of the raw `BadRequestError` message.
      toaster.error(
        HttpError.is(error, 400)
          ? String(tr("project.settings.areas.delete.blocked"))
          : error instanceof Error
            ? error.message
            : String(error),
      );
    }
  };

  const sources = props.areas.filter((a) => selected.has(a.id));
  const candidates = props.areas.filter((a) => !selected.has(a.id));

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

      {selected.size > 0 && (
        <div className="bg-muted flex items-center justify-between rounded-md px-3 py-2">
          <span className="text-sm">
            {String(
              selected.size === 1
                ? tr("project.settings.areas.selected.one")
                : tr("project.settings.areas.selected", {
                    args: [String(selected.size)],
                  }),
            )}
          </span>
          <Button size="sm" onClick={() => setMerging(true)}>
            {tr("project.settings.areas.merge.action")}
          </Button>
        </div>
      )}

      <Card className={settingsCardEdge}>
        <CardContent className="p-0">
          {props.areas.length === 0 ? (
            <div className="text-muted-foreground p-6 text-center text-sm">
              {tr("project.settings.areas.empty")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>
                    {tr("project.settings.areas.column.name")}
                  </TableHead>
                  <TableHead className="max-w-64">
                    {tr("project.settings.areas.column.summary")}
                  </TableHead>
                  <TableHead className="w-20 text-center">
                    {tr("project.settings.areas.column.open")}
                  </TableHead>
                  <TableHead className="w-20 text-center">
                    {tr("project.settings.areas.column.total")}
                  </TableHead>
                  <TableHead className="w-40">
                    {tr("project.settings.areas.column.lastActivity")}
                  </TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.areas.map((area) => (
                  <TableRow key={area.id}>
                    {/* `aria-label` on the cell itself, not just the checkbox:
                        without it, the checkbox's own accessible name (needed
                        so a screen reader announces which row a Tab lands on)
                        flattens into the enclosing `<td>`'s computed name too
                        ("Select Donjon" still *contains* "Donjon"), leaving it
                        indistinguishable from the name cell next to it for
                        anything that queries by cell name. Setting the cell's
                        own `aria-label` short-circuits that flattening. */}
                    <TableCell
                      aria-label={tr("project.settings.areas.column.select")}
                    >
                      <Checkbox
                        checked={selected.has(area.id)}
                        onCheckedChange={() => toggle(area.id)}
                        aria-label={tr("project.settings.areas.select", {
                          args: [area.name],
                        })}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link
                        href={router.path("projectSettingsArea", {
                          params: { areaId: area.id },
                        })}
                        className="hover:underline"
                      >
                        {area.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-64 truncate text-xs">
                      {descriptionSnippet(area.description)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{area.openQuestCount}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-center text-xs">
                      {area.questCount}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {area.lastQuestAt
                        ? dt.of(area.lastQuestAt).fromNow()
                        : tr("project.settings.areas.never")}
                    </TableCell>
                    <TableCell className="text-right">
                      {area.questCount === 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void remove(area)}
                        >
                          {tr("project.settings.areas.delete.action")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AreaMergeDialog
        open={merging}
        sources={sources}
        candidates={candidates}
        onClose={() => setMerging(false)}
        onMerged={() => void reload()}
      />
    </div>
  );
};

export default ProjectSettingsAreasPage;
