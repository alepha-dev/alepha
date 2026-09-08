import { PermissionMatrix } from "@alepha/ui/components/permission-matrix/permission-matrix";
import type { PermissionMatrixColumn } from "@alepha/ui/components/permission-matrix/permission-matrix";
import { settingsCardEdge } from "@alepha/ui/components/settings/settings-card-edge.ts";
import { Button } from "@alepha/ui/components/ui/button";
import { Card } from "@alepha/ui/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { cn } from "@alepha/ui/lib/utils";
import type { RankController, RankResource } from "alepha/api/ranks";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus, Save } from "lucide-react";
import { useEffect, useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { ProjectRankController } from "@/api/controllers/ProjectRankController.ts";
import type { Member } from "@/api/entities/members.ts";
import type { User } from "@/api/entities/users.ts";
import type { CapabilityKey } from "@/api/schemas/capabilityKeySchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { displayName } from "@/web/app/services/displayName.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ProjectRankColumnHeader from "./ProjectRankColumnHeader.tsx";
import type { PermissionCatalogueGroup } from "./projectRankMatrix.ts";
import { ProjectRankMatrix } from "./projectRankMatrix.ts";

/**
 * What each rank in this project may do, as one table.
 *
 * ## Why it is a page and not a card on Members
 *
 * The question it answers - "what can a Contributor actually do here?" - is
 * one an owner asks before ranking anybody, and the answer is thirty rows
 * wide. Members is where a person is given a rank; this is where a rank is
 * given a meaning.
 *
 * ## What this file owns, and what it does not
 *
 * The table is `@alepha/ui`'s {@link PermissionMatrix}, which knows nothing
 * about capabilities or owners. This page is the caller that does:
 *
 * - **Filtering** is {@link ProjectRankMatrix.rowsFor}: `admin:*` never
 *   appears, a group whose capability is off is dropped entirely rather than
 *   greyed, and the Core groups always show.
 * - **The owner column** is marked `readOnly` here, because "owner" is Lore's
 *   word.
 * - **The two locks** are the floor and the ceiling, plus anything the editor
 *   does not hold - the never-widen invariant surfaced rather than only
 *   enforced, so a checkbox never ticks and then fails to save.
 *
 * Every one of those is re-checked by `alepha/api/ranks` on write. This is the
 * affordance; the module is the rule.
 */
const ProjectSettingsRanksPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const rankApi = useClient<RankController>();
  const presetApi = useClient<ProjectRankController>();
  const projectApi = useClient<ProjectController>();
  const [project] = useStore(currentProjectAtom);

  const [catalogue, setCatalogue] = useState<PermissionCatalogueGroup[]>([]);
  const [ranks, setRanks] = useState<RankResource[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [presets, setPresets] = useState<RankPreset[]>([]);
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const projectId = project?.id;
  const scopeId = projectId === undefined ? "" : String(projectId);

  useEffect(() => {
    if (projectId === undefined) return;
    let cancelled = false;

    Promise.all([
      rankApi.getRankCatalogue({}),
      rankApi.getRanks({ params: { type: "project", scopeId } }),
      projectApi.getProjectMembers({ params: { id: projectId } }),
      presetApi.getRankPresets({ params: { projectId } }),
    ])
      .then(([catalogueRes, ranksRes, membersRes, presetsRes]) => {
        if (cancelled) return;
        setCatalogue(catalogueRes.groups);
        setRanks(ranksRes.items);
        setMembers(membersRes as never);
        setPresets(presetsRes.items);
        setDraft(ProjectSettingsRanksPage.draftOf(ranksRes.items));
        setLoaded(true);
      })
      .catch((error: unknown) => {
        // Not swallowed into an empty table: an editor shown three ranks that
        // are really four would save a set nobody chose.
        if (!cancelled) {
          toaster.error(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, scopeId, rankApi, projectApi, presetApi]);

  if (!project) return null;

  // ⚠️ `capabilities` is an ARRAY of `{ key, options }`, not a record keyed by
  // capability. `Object.keys` on it answers `["0", "1"]`, which matches no
  // capability at all - so every capability-owned group was filtered out and
  // the matrix showed six Core sections on a project that had Work on.
  const enabled = (project.capabilities ?? []).map(
    (it) => it.key,
  ) as CapabilityKey[];
  const held = project.permissions ?? [];

  const groups = ProjectRankMatrix.rowsFor({
    catalogue,
    enabled,
    held,
    label: (key, fallback) => (key ? String(tr(key as never)) : fallback),
  });

  const holdersOf = (key: string) =>
    members.filter((member) => (member.rank ?? "member") === key).length;

  const columns: PermissionMatrixColumn[] = ranks.map((rank) => ({
    key: rank.key,
    // ⚠️ The owner column is `readOnly`, and the shared component is told so
    // rather than asked to work it out. It is also the only column whose
    // stored set is `["*"]`, which no checkbox can express.
    readOnly: !rank.editable,
    // The count the matrix prints beside its own coverage ratio. A string, not
    // a node: it shares a line with "8/11" and has to wrap with it.
    description: String(
      tr("project.settings.ranks.holders", {
        args: [String(holdersOf(rank.key))],
      }),
    ),
    label: (
      <ProjectRankColumnHeader
        name={rank.name}
        builtin={rank.builtin}
        onRename={rank.editable ? () => void rename(rank) : undefined}
        onDelete={
          rank.builtin || !rank.editable ? undefined : () => void remove(rank)
        }
      />
    ),
  }));

  const dirty =
    loaded &&
    JSON.stringify(draft) !==
      JSON.stringify(ProjectSettingsRanksPage.draftOf(ranks));

  const save = async () => {
    setSaving(true);
    try {
      for (const rank of ranks) {
        if (!rank.editable) continue;
        const next = draft[rank.key] ?? [];
        if (
          JSON.stringify([...next].sort()) ===
          JSON.stringify([...rank.permissions].sort())
        ) {
          continue;
        }
        await rankApi.saveRank({
          params: { type: "project", scopeId, key: rank.key },
          body: { name: rank.name, permissions: next },
        });
      }
      await reload();
      toaster.success(tr("project.settings.ranks.saved"));
    } catch (error) {
      // The module's own message wins: "Your rank does not grant rank:manage",
      // "you cannot grant a permission you do not hold" and the self-lockout
      // refusal each say exactly what to change, and a catalogue string would
      // replace an answer with a shrug.
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const reload = async () => {
    const res = await rankApi.getRanks({
      params: { type: "project", scopeId },
    });
    setRanks(res.items);
    setDraft(ProjectSettingsRanksPage.draftOf(res.items));
  };

  const create = async (preset?: RankPreset) => {
    const name = await dialog.prompt({
      title: String(tr("project.settings.ranks.create.title")),
      description: String(tr("project.settings.ranks.create.description")),
      confirmLabel: String(tr("project.settings.ranks.create.confirm")),
      defaultValue: preset?.name ?? "",
    });
    if (!name?.trim()) return;

    try {
      await rankApi.saveRank({
        params: {
          type: "project",
          scopeId,
          // A key nobody types: it is stored on every membership row, and a
          // rank people rename must not move anybody's assignment. Derived
          // from the clock rather than from the name for exactly that reason.
          key: `r${Date.now().toString(36)}`,
        },
        body: {
          name: name.trim(),
          // Nothing was stored until this moment: the preset filled the cells
          // and the owner could have changed the name first.
          permissions: preset?.permissions ?? [],
        },
      });
      await reload();
      toaster.success(tr("project.settings.ranks.created"));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const rename = async (rank: RankResource) => {
    const name = await dialog.prompt({
      title: String(tr("project.settings.ranks.rename.title")),
      confirmLabel: String(tr("project.settings.ranks.rename.confirm")),
      defaultValue: rank.name,
    });
    if (!name?.trim() || name.trim() === rank.name) return;

    try {
      await rankApi.saveRank({
        params: { type: "project", scopeId, key: rank.key },
        body: { name: name.trim(), permissions: draft[rank.key] ?? [] },
      });
      await reload();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async (rank: RankResource) => {
    const holders = holdersOf(rank.key);

    if (holders > 0) {
      // Said before the click rather than discovered after it. The server
      // refuses this too, and the page has the one thing its message cannot
      // carry: where to go and fix it.
      await dialog.alert({
        title: String(
          tr("project.settings.ranks.delete.held.title", {
            args: [rank.name],
          }),
        ),
        description: String(
          tr("project.settings.ranks.delete.held.description", {
            args: [
              members
                .filter((it) => (it.rank ?? "member") === rank.key)
                .map((it) => displayName(it.user))
                .join(", "),
            ],
          }),
        ),
      });
      return;
    }

    const ok = await dialog.confirm({
      title: String(
        tr("project.settings.ranks.delete.title", { args: [rank.name] }),
      ),
      description: String(tr("project.settings.ranks.delete.description")),
      confirmLabel: String(tr("project.settings.ranks.delete.confirm")),
      destructive: true,
    });
    if (!ok) return;

    try {
      await rankApi.deleteRank({
        params: { type: "project", scopeId, key: rank.key },
      });
      await reload();
      toaster.success(tr("project.settings.ranks.deleted"));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">
            {tr("project.settings.ranks.title")}
          </span>
          <span className="text-muted-foreground text-xs">
            {tr("project.settings.ranks.description")}
          </span>
          {/* ⚠️ The 30 second window, disclosed the way the roadmap card
              discloses its cache. What a rank GRANTS is read through a cache;
              WHO holds a rank is not, so a demotion and a removal both take
              effect on the next request. Saying only the first half would
              read as "revocation is slow", which is the opposite of true. */}
          <span className="text-muted-foreground text-xs">
            {tr("project.settings.ranks.delay")}
          </span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <Plus className="size-3.5" />
            {tr("project.settings.ranks.create")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void create()}>
              {tr("project.settings.ranks.create.blank")}
            </DropdownMenuItem>
            {presets.length > 0 && <DropdownMenuSeparator />}
            {presets.map((preset) => (
              <DropdownMenuItem
                key={preset.key}
                onClick={() => void create(preset)}
              >
                {tr("project.settings.ranks.create.preset", {
                  args: [preset.name],
                })}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Card className={cn(settingsCardEdge, "gap-0 py-0")}>
        <PermissionMatrix
          header={tr("project.settings.ranks.permission")}
          empty={tr("project.settings.ranks.empty")}
          disabled={saving}
          groups={groups}
          columns={columns}
          value={draft}
          onChange={setDraft}
        />
      </Card>

      {dirty && (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => setDraft(ProjectSettingsRanksPage.draftOf(ranks))}
          >
            {tr("common.cancel")}
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            <Save className="size-4" />
            {tr("project.settings.ranks.save")}
          </Button>
        </div>
      )}
    </div>
  );
};

/**
 * The draft the matrix edits, seeded from what the server holds.
 *
 * A static because it is called from three places - the first load, the
 * dirty check and Cancel - and a copy in each is a copy that can disagree
 * about whether an owner's `["*"]` belongs in it. It does not: a wildcard is
 * not a set of checkboxes, and the owner column is `readOnly` anyway.
 */
ProjectSettingsRanksPage.draftOf = (
  ranks: RankResource[],
): Record<string, string[]> =>
  Object.fromEntries(
    ranks
      .filter((rank) => rank.editable)
      .map((rank) => [rank.key, [...rank.permissions]]),
  );

export default ProjectSettingsRanksPage;

// ---------------------------------------------------------------------------------------------------------------------

interface RankPreset {
  key: string;
  name: string;
  permissions: string[];
}

/**
 * A membership row with the account behind it, which is what
 * `getProjectMembers` answers. Named here rather than inlined because the
 * delete refusal names the people, not the count.
 */
type ProjectMember = Member & { user: User };
