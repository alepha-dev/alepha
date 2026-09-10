import { $env, $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import type { Project } from "../schemas/projectSchema.ts";
import type { QuestRef } from "../schemas/questRefSchema.ts";

/**
 * The fields Loom reads from Lore's quest resource.
 */
export interface LoreQuest {
  shortId: number;
  title: string;
  status: string;
  epicId?: number | null;
}

/**
 * The fields Loom reads from Lore's epic refs.
 */
export interface LoreEpicRef {
  id: number;
  number: number;
  title: string;
  status: string;
}

/**
 * Lore, for the quests a branch's commits name.
 *
 * Every commit in this repository names its quest as `#Q<n>`, so a branch's
 * own commits say which quests it carries. The numbers need nothing; their
 * titles, status and epic need the Lore API, which takes an API key from the
 * account's API keys page as `LORE_API_KEY`. Without one, a quest is its
 * number and, when the project names its Lore slug, a link.
 */
export class LoreService {
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly log = $logger();

  protected readonly env = $env(
    z.object({
      LORE_API_KEY: z.text({
        default: "",
        description:
          "API key for Lore, from the account's API keys page. Without it Loom shows quest numbers but not their titles. Secret.",
      }),
      LORE_URL: z.text({
        default: "https://lore.alepha.dev",
        secret: false,
        description: "Origin of the Lore instance quests are read from.",
      }),
    }),
  );

  protected readonly questTtl = 120_000;
  protected readonly epicTtl = 300_000;

  protected readonly questCache = new Map<
    string,
    { at: number; quest?: LoreQuest }
  >();
  protected readonly epicCache = new Map<
    number,
    { at: number; epics: Map<number, LoreEpicRef> }
  >();

  public enabled(): boolean {
    return String(this.env.LORE_API_KEY).length > 0;
  }

  /**
   * Every `#Q<n>` in some text, newest first as `git log` lists them, each
   * once.
   */
  public questIds(text: string): number[] {
    const ids: number[] = [];
    for (const match of text.matchAll(/#Q(\d+)\b/g)) {
      const id = Number(match[1]);
      if (!ids.includes(id)) {
        ids.push(id);
      }
    }
    return ids;
  }

  public async resolve(
    project: Project,
    shortIds: number[],
  ): Promise<Map<number, QuestRef>> {
    const refs = new Map<number, QuestRef>();
    for (const shortId of shortIds) {
      refs.set(shortId, { shortId, url: this.url(project, shortId) });
    }
    if (!this.enabled() || !project.loreProjectId || shortIds.length === 0) {
      return refs;
    }

    const projectId = project.loreProjectId;
    const [epics, quests] = await Promise.all([
      this.epics(projectId),
      Promise.all(shortIds.map((shortId) => this.quest(projectId, shortId))),
    ]);
    for (const quest of quests) {
      if (!quest) {
        continue;
      }
      const epic = quest.epicId ? epics?.get(quest.epicId) : undefined;
      refs.set(quest.shortId, {
        shortId: quest.shortId,
        title: quest.title,
        status: quest.status,
        url: this.url(project, quest.shortId),
        epic: epic
          ? { number: epic.number, title: epic.title, status: epic.status }
          : undefined,
      });
    }
    return refs;
  }

  protected url(project: Project, shortId: number): string | undefined {
    if (!project.loreProjectSlug) {
      return undefined;
    }
    const origin = String(this.env.LORE_URL).replace(/\/$/, "");
    return `${origin}/${project.loreProjectSlug}/quests/${shortId}`;
  }

  protected async quest(
    projectId: number,
    shortId: number,
  ): Promise<LoreQuest | undefined> {
    const key = `${projectId}:${shortId}`;
    const now = this.dateTime.nowMillis();
    const cached = this.questCache.get(key);
    if (cached && now - cached.at < this.questTtl) {
      return cached.quest;
    }
    const quest = await this.request<LoreQuest>(
      `/api/projects/${projectId}/quests/${shortId}`,
    );
    this.questCache.set(key, { at: now, quest });
    return quest;
  }

  protected async epics(
    projectId: number,
  ): Promise<Map<number, LoreEpicRef> | undefined> {
    const now = this.dateTime.nowMillis();
    const cached = this.epicCache.get(projectId);
    if (cached && now - cached.at < this.epicTtl) {
      return cached.epics;
    }
    const refs = await this.request<LoreEpicRef[]>(
      `/api/getEpicRefs/${projectId}`,
    );
    if (!refs) {
      return cached?.epics;
    }
    const epics = new Map(refs.map((epic) => [epic.id, epic]));
    this.epicCache.set(projectId, { at: now, epics });
    return epics;
  }

  protected async request<T>(path: string): Promise<T | undefined> {
    const origin = String(this.env.LORE_URL).replace(/\/$/, "");
    try {
      const response = await fetch(`${origin}${path}`, {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${String(this.env.LORE_API_KEY)}`,
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        this.log.warn(`Lore ${path} answered ${response.status}`);
        return undefined;
      }
      return (await response.json()) as T;
    } catch (error) {
      this.log.warn(`Lore ${path} failed`, error);
      return undefined;
    }
  }
}
