import { $repository, $sequence } from "alepha/orm";
import { type Project, projects } from "../entities/projects.ts";
import { normalizeQuestTags, type Quest, quests } from "../entities/quests.ts";

/**
 * Quest rich-text fields (`description`, `note`, `completionMessage`) are
 * **Markdown**, not HTML: they are authored by `MarkdownEditor` and rendered
 * by `MarkdownView`, which mounts no `rehype-raw` and leaves react-markdown's
 * default in place — every raw node is escaped to text. That posture is
 * pinned by `markdown-view-raw-html.browser.spec.tsx`, whose whole purpose is
 * to turn red if someone reaches for `rehype-raw` later.
 *
 * So there is deliberately **no sanitizer here.** A `sanitizeHtml` helper
 * used to run on `description` and `note` — a leftover from the TipTap
 * rich-text editor `MarkdownEditor` replaced, allow-listing the tags TipTap
 * emitted. Against Markdown it was not a defence but a corrupter: it deleted
 * any `<word…>` whose name was not allow-listed, code spans and fenced
 * blocks included, silently eating TypeScript generics, JSX snippets and
 * `<placeholder>` text out of quest bodies (quest #1231).
 *
 * Do not reintroduce one. There is no correct storage-level HTML
 * sanitization for a Markdown field: deleting loses content, and escaping to
 * `&lt;` renders literally inside a code span. The renderer is the defence,
 * and `completionMessage` has always been stored unsanitized on exactly that
 * basis. If a surface ever needs to render these as HTML, sanitize *there*.
 */

/**
 * Input for {@link QuestService.createQuest} — the common shape every quest
 * creation path supplies. Optional fields fall back to the same defaults the
 * old inline `quests.create({...})` calls used.
 */
export interface CreateQuestInput {
  projectId: number;
  /** Plain or rich-text title. */
  title: string;
  /** Rich-text description — sanitized inside the service before insert. */
  description: string;
  /** Target area. Created on the project if it does not exist yet. */
  area: string;
  priority?: Quest["priority"];
  difficulty?: number;
  /** Optional glanceable time estimate in minutes; `null`/`undefined` = none. */
  estimateMinutes?: number | null;
  objectives?: Array<{ id?: number; title: string; completed: boolean }>;
  attachments?: string[];
  tags?: string[];
  dependsOn?: number | null;
  feedbackId?: number;
  /** Provenance marker, e.g. `{ sigilBlightId }` for blight-forwarded quests. */
  source?: Quest["source"];
  /** Id of the user creating the quest. */
  createdBy: string;
}

/**
 * The single owner of quest-creation mechanics — the `quests.shortId`
 * sequence, the project area-ensure step, and the `quests.create({...})`
 * payload with defaults.
 *
 * Both `QuestController.createQuest` and
 * `BlightController.forwardBlightToQuest` delegate here so the two paths can
 * never diverge again (the blight path historically skipped sanitization,
 * back when there was any).
 * Controllers keep ownership of auth / permission checks; only the creation
 * mechanics live here.
 *
 * Declaring `$repository(quests)` / `$repository(projects)` here also keeps
 * those tables in the ORM/migration graph — same pattern as `SigilService`.
 */
export class QuestService {
  protected readonly quests = $repository(quests);
  protected readonly projects = $repository(projects);

  /**
   * Per-project sequence for `quests.shortId`. Advances inside the caller's
   * `$transactional` block on create, so failed inserts return the id to the
   * pool instead of burning it.
   */
  protected readonly questShortId = $sequence();

  /**
   * Backfill / generate stable `id` for each objective in the array.
   * - Legacy objectives (`id == null` across the board): assign by current
   *   index — deterministic, matches what the mapper synthesizes on read.
   * - Mixed sets (some have ids): preserve existing ids, assign
   *   `max(existing) + 1, +2, ...` to the ones missing one.
   */
  ensureObjectiveIds(objectives: Quest["objectives"]): Quest["objectives"] {
    const used = new Set<number>();
    for (const o of objectives) if (o.id != null) used.add(o.id);
    const legacy = used.size === 0;
    let nextFreeId = used.size > 0 ? Math.max(...used) + 1 : 0;
    return objectives.map((obj, index) => {
      if (obj.id != null) return obj;
      if (legacy) {
        used.add(index);
        return { ...obj, id: index };
      }
      while (used.has(nextFreeId)) nextFreeId++;
      const id = nextFreeId++;
      used.add(id);
      return { ...obj, id };
    });
  }

  /**
   * Collect quest-attachment file ids embedded in markdown text (the
   * editor emits `![alt](/api/files/<uuid>)`) and merge them into the
   * given attachments list.
   *
   * Runs server-side on every write that carries markdown (description,
   * note, completion message) so embedded images become quest
   * attachments regardless of the author — web editor or MCP agent.
   * Being listed in `quest.attachments` is what lets
   * `LoreFileAccessProvider` resolve the file to a project and grant
   * every member read access; an unmerged embed would 403 for anyone
   * but its uploader.
   */
  mergeEmbeddedAttachments(
    texts: Array<string | undefined>,
    current: string[],
  ): string[] {
    const found = new Set(current);
    const pattern =
      /\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
    for (const text of texts) {
      if (!text) continue;
      for (const match of text.matchAll(pattern)) {
        found.add(match[1]);
      }
    }
    return [...found];
  }

  /**
   * Create a quest. Holds the shared mechanics:
   * 1. allocate the next per-project `shortId`,
   * 2. sanitize the (attacker-controllable) rich-text description,
   * 3. ensure `area` exists on `project.areas`, persisting it if not,
   * 4. insert the `quests` row with the standard defaults.
   *
   * The caller passes the already-loaded `project` (it has done the auth
   * check) so the service does not re-fetch it. Must run inside a
   * `$transactional()` block — the `shortId` sequence relies on it.
   */
  async createQuest(project: Project, input: CreateQuestInput): Promise<Quest> {
    const shortId = await this.questShortId.next(String(input.projectId));

    // Only register non-empty areas — an empty `area` is a valid quest
    // field but must not pollute the project's area list.
    if (input.area && !project.areas.includes(input.area)) {
      project.areas.push(input.area);
      await this.projects.updateById(project.id, {
        areas: project.areas,
      });
    }

    return this.quests.create({
      projectId: input.projectId,
      shortId,
      title: input.title,
      description: input.description,
      area: input.area,
      priority: input.priority ?? "medium",
      difficulty: input.difficulty ?? 2,
      estimateMinutes: input.estimateMinutes ?? undefined,
      objectives: this.ensureObjectiveIds(input.objectives ?? []),
      attachments: this.mergeEmbeddedAttachments(
        [input.description],
        input.attachments ?? [],
      ),
      tags: normalizeQuestTags(input.tags ?? []),
      dependsOn: input.dependsOn ?? undefined,
      feedbackId: input.feedbackId,
      source: input.source,
      createdBy: input.createdBy,
      history: [],
    });
  }
}
