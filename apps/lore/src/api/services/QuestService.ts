import { $repository, $sequence } from "alepha/orm";
import { type Campaign, campaigns } from "../entities/campaigns.ts";
import { normalizeQuestTags, type Quest, quests } from "../entities/quests.ts";

/**
 * Tags matching what TipTap StarterKit + Mantine controls produce.
 */
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "em",
  "u",
  "s",
  "mark",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "hr",
]);

/**
 * Strip every tag not in `ALLOWED_TAGS` (plus `<script>` / `<style>` /
 * comments) from a rich-text quest field. Attacker-controlled HTML must
 * pass through here before it is persisted.
 */
export const sanitizeHtml = (html: string): string => {
  return html
    .replace(/<script[\s>][\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s>][\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*\/?>/gi, (match, tag: string) => {
      const lower = tag.toLowerCase();
      if (!ALLOWED_TAGS.has(lower)) return "";
      if (match.startsWith("</")) return `</${lower}>`;
      if (lower === "br" || lower === "hr") return `<${lower}>`;
      return `<${lower}>`;
    });
};

/**
 * Input for {@link QuestService.createQuest} — the common shape every quest
 * creation path supplies. Optional fields fall back to the same defaults the
 * old inline `quests.create({...})` calls used.
 */
export interface CreateQuestInput {
  campaignId: number;
  /** Plain or rich-text title. */
  title: string;
  /** Rich-text description — sanitized inside the service before insert. */
  description: string;
  /** Target zone. Created on the campaign if it does not exist yet. */
  zone: string;
  priority?: Quest["priority"];
  difficulty?: number;
  /** Optional glanceable time estimate in minutes; `null`/`undefined` = none. */
  estimateMinutes?: number | null;
  objectives?: Array<{ id?: number; title: string; completed: boolean }>;
  attachments?: string[];
  tags?: string[];
  dependsOn?: number | null;
  petitionId?: number;
  /** Provenance marker, e.g. `{ sigilBlightId }` for blight-forwarded quests. */
  source?: Quest["source"];
  /** Id of the user creating the quest. */
  createdBy: string;
}

/**
 * The single owner of quest-creation mechanics — the `quests.shortId`
 * sequence, the campaign zone-ensure step, HTML sanitization of the
 * description, and the `quests.create({...})` payload with defaults.
 *
 * Both `QuestController.createQuest` and
 * `BlightController.forwardBlightToQuest` delegate here so the two paths can
 * never diverge again (the blight path historically skipped `sanitizeHtml`).
 * Controllers keep ownership of auth / permission checks; only the creation
 * mechanics live here.
 *
 * Declaring `$repository(quests)` / `$repository(campaigns)` here also keeps
 * those tables in the ORM/migration graph — same pattern as `SigilService`.
 */
export class QuestService {
  protected readonly quests = $repository(quests);
  protected readonly campaigns = $repository(campaigns);

  /**
   * Per-campaign sequence for `quests.shortId`. Advances inside the caller's
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
   * `LoreFileAccessProvider` resolve the file to a campaign and grant
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
   * 1. allocate the next per-campaign `shortId`,
   * 2. sanitize the (attacker-controllable) rich-text description,
   * 3. ensure `zone` exists on `campaign.zones`, persisting it if not,
   * 4. insert the `quests` row with the standard defaults.
   *
   * The caller passes the already-loaded `campaign` (it has done the auth
   * check) so the service does not re-fetch it. Must run inside a
   * `$transactional()` block — the `shortId` sequence relies on it.
   */
  async createQuest(
    campaign: Campaign,
    input: CreateQuestInput,
  ): Promise<Quest> {
    const shortId = await this.questShortId.next(String(input.campaignId));

    // Only register non-empty zones — an empty `zone` is a valid quest
    // field but must not pollute the campaign's zone list.
    if (input.zone && !campaign.zones.includes(input.zone)) {
      campaign.zones.push(input.zone);
      await this.campaigns.updateById(campaign.id, {
        zones: campaign.zones,
      });
    }

    return this.quests.create({
      campaignId: input.campaignId,
      shortId,
      title: input.title,
      description: sanitizeHtml(input.description),
      zone: input.zone,
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
      petitionId: input.petitionId,
      source: input.source,
      createdBy: input.createdBy,
      history: [],
    });
  }
}
