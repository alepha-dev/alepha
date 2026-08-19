import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@alepha/ui/components/ui/table";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { X } from "lucide-react";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import QuestGraph from "../quest/QuestGraph.tsx";
import EpicQuestPicker from "./EpicQuestPicker.tsx";

export interface ProjectEpicQuestsProps {
  projectId: number;
  /**
   * `null` means "not loaded yet" (in flight, or the last fetch failed) —
   * distinct from a successfully resolved `[]`, so a failed reload never
   * renders as "no quests in this epic".
   */
  quests: QuestResource[] | null;
  onAttach: (questId: number) => void;
  onDetach: (quest: QuestResource) => void;
}

/**
 * Zone 4 of the Epic page: the full quest set — shelved and planned-gated
 * quests included, since `EpicController`'s rollup and the `epic`-filtered
 * `QuestController.getQuests` call that feeds this component both bypass
 * the backlog gate on purpose — plus the dependency flow, `QuestGraph` in
 * subset mode (`collectSubset`). The flow renders the epic's own quests
 * even when they carry no `dependsOn` edges at all, and keeps an
 * out-of-epic predecessor as a stub node so a blocked quest never looks
 * ready just because its blocker lives in another epic.
 */
const ProjectEpicQuests = (props: ProjectEpicQuestsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const quests = props.quests;
  const attachedIds = new Set((quests ?? []).map((q) => q.id));

  return (
    <Card className="py-0 shadow">
      <CardHeader className="flex flex-row items-center justify-between gap-2 p-4">
        <CardTitle>{tr("epic.quests.title")}</CardTitle>
        <EpicQuestPicker
          projectId={props.projectId}
          attachedIds={attachedIds}
          onAttach={props.onAttach}
        />
      </CardHeader>
      <CardContent className="p-0">
        {quests === null ? (
          <div className="text-muted-foreground p-6 text-center text-sm">
            {tr("epic.quests.loading")}
          </div>
        ) : quests.length === 0 ? (
          <div className="text-muted-foreground p-6 text-center text-sm">
            {tr("epic.quests.empty")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">
                  {tr("epic.quests.column.number")}
                </TableHead>
                <TableHead>{tr("epic.quests.column.title")}</TableHead>
                <TableHead className="w-32">
                  {tr("epic.quests.column.status")}
                </TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {quests.map((quest) => (
                <TableRow key={quest.id}>
                  <TableCell className="text-muted-foreground">
                    #{quest.shortId}
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={router.path("projectQuest", {
                        params: { shortId: quest.shortId },
                      })}
                      className="hover:underline"
                    >
                      {quest.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        QUEST_STATUS_BADGE_VARIANT[quest.metadata.status]
                      }
                    >
                      {tr(QUEST_STATUS_LABEL_KEYS[quest.metadata.status])}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      aria-label={tr("epic.quests.detach")}
                      onClick={() => props.onDetach(quest)}
                    >
                      <X className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {quests != null && quests.length > 0 && (
        <div className="border-border h-[480px] border-t">
          <QuestGraph questIds={attachedIds} />
        </div>
      )}
    </Card>
  );
};

export default ProjectEpicQuests;

type QuestStatus = QuestResource["metadata"]["status"];

type QuestStatusLabelKey =
  | "epic.quests.status.new"
  | "epic.quests.status.accepted"
  | "epic.quests.status.completed"
  | "epic.quests.status.shelved";

const QUEST_STATUS_LABEL_KEYS: Record<QuestStatus, QuestStatusLabelKey> = {
  new: "epic.quests.status.new",
  accepted: "epic.quests.status.accepted",
  completed: "epic.quests.status.completed",
  shelved: "epic.quests.status.shelved",
};

const QUEST_STATUS_BADGE_VARIANT: Record<
  QuestStatus,
  "outline" | "default" | "secondary"
> = {
  new: "outline",
  accepted: "default",
  completed: "secondary",
  shelved: "outline",
};
