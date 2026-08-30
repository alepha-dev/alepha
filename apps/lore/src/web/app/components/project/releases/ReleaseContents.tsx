import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { CircleCheck, CircleDashed, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { EpicController } from "@/api/controllers/EpicController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { ReleaseController } from "@/api/controllers/ReleaseController.ts";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

interface EpicCard {
  id: number;
  number: number;
  title: string;
  status: string;
  completed: number;
  total: number;
}

interface LooseQuest {
  id: number;
  shortId: number;
  title: string;
  area?: string;
  priority: string;
  completedAt?: string;
}

export interface ReleaseContentsProps {
  releaseId: number;
  /**
   * A published release is a record. Its contents are still listed - that is
   * what it shipped - but nothing offers to change them.
   */
  readOnly: boolean;
  onChanged: () => void;
}

/**
 * What is in the release: one card per attached epic with its own progress and
 * its quests, then the loose quests grouped by the area they were done in.
 *
 * This is the substance of the page. The owner's phrasing for what a release
 * page should show was "the changelog of epics and quests", and an epic is the
 * headline while a loose quest is a line item.
 */
const ReleaseContents = (props: ReleaseContentsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const releaseApi = useClient<ReleaseController>();
  const epicApi = useClient<EpicController>();
  const questApi = useClient<QuestController>();

  const [epics, setEpics] = useState<EpicCard[]>([]);
  const [looseQuests, setLooseQuests] = useState<LooseQuest[]>([]);
  const [epicQuests, setEpicQuests] = useState<Map<number, LooseQuest[]>>(
    new Map(),
  );
  const [attachableEpics, setAttachableEpics] = useState<EpicResource[]>([]);
  const [attachableQuests, setAttachableQuests] = useState<LooseQuest[]>([]);
  const [adding, setAdding] = useState<"epic" | "quest" | null>(null);

  const fetchContents = useCallback(
    () => releaseApi.getReleaseContents({ params: { id: props.releaseId } }),
    [props.releaseId],
  );

  const load = useCallback(async () => {
    const contents = await fetchContents();
    setEpics(contents.epics);
    setLooseQuests(contents.looseQuests);
  }, [fetchContents]);

  useEffect(() => {
    let cancelled = false;
    fetchContents()
      .then((contents) => {
        if (cancelled) return;
        setEpics(contents.epics);
        setLooseQuests(contents.looseQuests);
      })
      // A panel on a page that already renders: a failed fetch leaves the
      // section empty rather than breaking the release around it.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [props.releaseId]);

  // The epic's own quests, fetched per card rather than folded into
  // `getReleaseContents`: the endpoint answers "what is in this release" and
  // a card's quest list is a detail only an expanded card needs.
  useEffect(() => {
    if (!project || epics.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next = new Map<number, LooseQuest[]>();
      for (const epic of epics) {
        try {
          const page = await questApi.getQuests({
            params: { projectId: project.id },
            query: { epic: epic.id, size: 50 } as never,
          });
          next.set(epic.id, page.content as never as LooseQuest[]);
        } catch {
          // One card without its quests beats no cards at all.
        }
      }
      if (!cancelled) setEpicQuests(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [project?.id, epics.map((e) => e.id).join(",")]);

  const openAddEpic = async () => {
    if (!project) return;
    setAdding("epic");
    try {
      const all = await epicApi.getEpics({ params: { projectId: project.id } });
      // Only epics that are in NO release: an epic belongs to at most one, so
      // offering one that is already placed would silently move it out of
      // wherever it was.
      setAttachableEpics(all.filter((epic) => epic.releaseId == null));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
      setAdding(null);
    }
  };

  const openAddQuest = async () => {
    if (!project) return;
    setAdding("quest");
    try {
      // Open quests only, and only ones not already in a release. A completed
      // quest can be attached from its own page, but offering it here would
      // suggest a release is a place to file finished work - which is exactly
      // the recorder this epic deleted.
      const page = await questApi.getQuests({
        params: { projectId: project.id },
        query: { status: "new", size: 50 } as never,
      });
      setAttachableQuests(
        (page.content as never as Array<LooseQuest & { releaseId?: number }>)
          .filter((quest) => quest.releaseId == null)
          .map((quest) => quest as LooseQuest),
      );
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
      setAdding(null);
    }
  };

  const attachQuest = async (questId: number) => {
    try {
      await questApi.updateQuestById({
        params: { id: questId },
        body: { releaseId: props.releaseId },
      });
      setAdding(null);
      await load();
      props.onChanged();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const attachEpic = async (epicId: number) => {
    try {
      await epicApi.updateEpic({
        params: { id: epicId },
        body: { releaseId: props.releaseId },
      });
      setAdding(null);
      await load();
      props.onChanged();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const detachEpic = async (epicId: number) => {
    try {
      await epicApi.updateEpic({
        params: { id: epicId },
        body: { releaseId: null },
      });
      await load();
      props.onChanged();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const byArea = new Map<string, LooseQuest[]>();
  for (const quest of looseQuests) {
    const area = quest.area || tr("release.contents.uncategorized");
    const list = byArea.get(String(area)) ?? [];
    list.push(quest);
    byArea.set(String(area), list);
  }

  const questRow = (quest: LooseQuest) => (
    <Link
      key={quest.id}
      href={router.path("projectQuest", {
        params: { shortId: String(quest.shortId) },
      })}
      className="hover:bg-muted/50 flex items-center gap-2 rounded px-2 py-1.5 text-[13px]"
    >
      {quest.completedAt ? (
        <CircleCheck className="size-3.5 shrink-0 text-green-600" />
      ) : (
        <CircleDashed className="text-muted-foreground size-3.5 shrink-0" />
      )}
      <span className="text-muted-foreground w-9 shrink-0 font-mono text-[11px]">
        #{quest.shortId}
      </span>
      <span className="min-w-0 flex-1 truncate">{quest.title}</span>
    </Link>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-[15px] font-semibold">
          {tr("release.contents.title")}
        </h2>
        {/* Attaching from the release side. The write path is the same one
            the epic page and the quest rail use (#1552, #1553); this is a
            second door to it, not a second path. */}
        {!props.readOnly && adding === null && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openAddEpic()}
            >
              <Plus className="size-3.5" />
              {tr("release.contents.addEpic")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openAddQuest()}
            >
              <Plus className="size-3.5" />
              {tr("release.contents.addQuest")}
            </Button>
          </>
        )}
        {!props.readOnly && adding !== null && (
          <div className="flex items-center gap-2">
            <Select
              onValueChange={(v) =>
                void (adding === "epic"
                  ? attachEpic(Number(v))
                  : attachQuest(Number(v)))
              }
            >
              <SelectTrigger size="sm" className="w-56">
                <SelectValue
                  placeholder={tr(
                    adding === "epic"
                      ? "release.contents.pickEpic"
                      : "release.contents.pickQuest",
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {adding === "epic"
                  ? attachableEpics.map((epic) => (
                      <SelectItem key={epic.id} value={String(epic.id)}>
                        #{epic.number} {epic.title}
                      </SelectItem>
                    ))
                  : attachableQuests.map((quest) => (
                      <SelectItem key={quest.id} value={String(quest.id)}>
                        #{quest.shortId} {quest.title}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={() => setAdding(null)}>
              {tr("common.cancel")}
            </Button>
          </div>
        )}
      </div>

      {epics.length === 0 && looseQuests.length === 0 && (
        <p className="text-muted-foreground text-[13px]">
          {tr("release.contents.empty")}
        </p>
      )}

      {epics.map((epic) => (
        <div key={epic.id} className="border-border rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-[11px]">
              #{epic.number}
            </Badge>
            <Link
              href={router.path("projectEpic", {
                params: { epicNumber: String(epic.number) },
              })}
              className="min-w-0 flex-1 truncate text-[14px] font-medium"
            >
              {epic.title}
            </Link>
            <span className="bg-muted h-1.5 w-20 shrink-0 overflow-hidden rounded-full">
              <span
                className="block h-full rounded-full bg-green-600"
                style={{
                  width: `${
                    epic.total > 0
                      ? Math.round((epic.completed / epic.total) * 100)
                      : 0
                  }%`,
                }}
              />
            </span>
            <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
              {epic.completed}/{epic.total}
            </span>
            {!props.readOnly && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void detachEpic(epic.id)}
              >
                {tr("release.contents.remove")}
              </Button>
            )}
          </div>
          <div className="mt-2">
            {(epicQuests.get(epic.id) ?? []).map(questRow)}
          </div>
        </div>
      ))}

      {[...byArea].map(([area, quests]) => (
        <div key={area} className="border-border rounded-lg border p-4">
          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="text-muted-foreground font-mono text-[11px] font-medium tracking-[0.06em] uppercase">
              {area}
            </span>
            <span className="text-muted-foreground text-[11px]">
              {quests.length}
            </span>
            <div className="bg-border h-px flex-1" />
          </div>
          {quests.map(questRow)}
        </div>
      ))}
    </div>
  );
};

export default ReleaseContents;
