import {
  rewriteWikiLinks,
  type ElementReference,
  type AttachmentRef,
  createWikiLinkResolver,
  type WikiLinkResolver,
  ElementReferenceRegistry,
} from "@lore/core/web";
import { KnowledgeShell } from "@lore/knowledge/web";
import { WorkShell } from "@lore/work/web";
import { Alepha } from "alepha";

/**
 * The reference kinds as the app registers them (#E75, #Q2624): Knowledge's
 * folios and Work's quests, epics, feedback and releases, from their shells,
 * so a spec resolves links exactly as the browser does.
 */
export class WikiLinkFixture {
  protected static readonly alepha = (() => {
    const alepha = Alepha.create();
    alepha.inject(KnowledgeShell);
    alepha.inject(WorkShell);
    return alepha;
  })();

  public static kinds() {
    return WikiLinkFixture.alepha.inject(ElementReferenceRegistry).kinds();
  }

  /**
   * The registered resolver, over rows given by kind in the shape each
   * module's lookups answer.
   */
  public static resolver(input: WikiLinkFixtureRows): WikiLinkResolver {
    return createWikiLinkResolver({
      projectSlug: input.projectSlug,
      kinds: WikiLinkFixture.kinds(),
      refs: WikiLinkFixture.refs(input),
      attachments: input.attachments,
    });
  }

  /**
   * `rewriteWikiLinks` with the registered kinds, taking the rows
   * positionally as the pre-registry `rewriteFolioWikiLinks` did.
   */
  public static rewrite(
    content: string,
    projectSlug: string,
    folios: Array<{ shortId: number; title: string }>,
    quests: Array<{ shortId: number; title: string }>,
    attachments: AttachmentRef[] = [],
    epics: Array<{ shortId: number; title: string }> = [],
    feedback: Array<{ shortId: number; title: string; status?: string }> = [],
    releases: Array<{ number: number; title: string; tag?: string }> = [],
  ): string {
    return rewriteWikiLinks(content, {
      projectSlug,
      kinds: WikiLinkFixture.kinds(),
      refs: WikiLinkFixture.refs({
        projectSlug,
        folios,
        quests,
        epics,
        feedback,
        releases,
      }),
      attachments,
    });
  }

  protected static refs(
    input: WikiLinkFixtureRows,
  ): Record<string, ElementReference[]> {
    const byShortId = (rows: Array<{ shortId: number; title: string }> = []) =>
      rows.map((row) => ({ number: row.shortId, title: row.title }));
    return {
      folio: byShortId(input.folios),
      quest: byShortId(input.quests),
      epic: byShortId(input.epics),
      feedback: byShortId(input.feedback),
      release: (input.releases ?? []).map((row) => ({
        number: row.number,
        title: row.title,
        tag: row.tag,
      })),
    };
  }
}

export interface WikiLinkFixtureRows {
  projectSlug: string;
  folios?: Array<{ shortId: number; title: string }>;
  quests?: Array<{ shortId: number; title: string }>;
  epics?: Array<{ shortId: number; title: string }>;
  feedback?: Array<{ shortId: number; title: string; status?: string }>;
  releases?: Array<{ number: number; title: string; tag?: string }>;
  attachments?: AttachmentRef[];
}
