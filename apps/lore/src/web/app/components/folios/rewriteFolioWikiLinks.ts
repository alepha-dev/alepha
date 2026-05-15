import type { Folio } from "@/api/entities/folios.ts";

/**
 * Rewrite `[[...]]` wiki-link tokens in folio markdown into standard
 * markdown anchor syntax so the existing `<a>` renderer in MarkdownView
 * handles them. Mirrors the server-side `FolioLinkService.parseToken`
 * rules so what gets displayed matches what gets persisted in
 * `folio_links` — out-of-sync resolution would lie to the reader.
 *
 * Supported forms (all backwards-compatible with the pre-quest #57
 * folio-only syntax):
 *
 *  - `[[#42]]` → folio shortId 42 in the same campaign.
 *  - `[[Folio Title]]` → folio by title (case-insensitive, ambiguous
 *    titles fall back to literal text).
 *  - `[[#42#zones]]` / `[[Folio Title#zones]]` → folio + heading slug.
 *  - `[[quest#32]]` → quest shortId 32 in the same campaign.
 *  - `[[quest:Some Title]]` → quest by title (resolved if a quest list
 *    is supplied; otherwise rendered as plain text).
 *
 * Unresolved references render as the original `[[...]]` literal so the
 * author sees a broken link rather than getting a silent miss.
 */
export const rewriteFolioWikiLinks = (
  content: string,
  campaignId: number,
  folios: Folio[],
  quests: Array<{ shortId: number; title: string }>,
): string => {
  if (!content || !content.includes("[[")) return content;

  const folioByShort = new Map<number, Folio>();
  const folioByTitle = new Map<string, { folio: Folio; count: number }>();
  for (const f of folios) {
    folioByShort.set(f.shortId, f);
    const key = f.title.toLowerCase().trim();
    const existing = folioByTitle.get(key);
    if (existing) existing.count++;
    else folioByTitle.set(key, { folio: f, count: 1 });
  }

  const questByShort = new Map<number, { shortId: number; title: string }>();
  const questByTitle = new Map<
    string,
    { quest: { shortId: number; title: string }; count: number }
  >();
  for (const q of quests) {
    questByShort.set(q.shortId, q);
    const key = q.title.toLowerCase().trim();
    const existing = questByTitle.get(key);
    if (existing) existing.count++;
    else questByTitle.set(key, { quest: q, count: 1 });
  }

  return content.replace(/\[\[([^\]\n]+)\]\]/g, (_full, body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return `[[${body}]]`;

    // Type prefix (folio | quest). Bare token = folio.
    let type: "folio" | "quest" = "folio";
    let rest = trimmed;
    const colonIdx = rest.indexOf(":");
    if (colonIdx > 0) {
      const prefix = rest.slice(0, colonIdx).trim().toLowerCase();
      if (prefix === "quest" || prefix === "folio") {
        type = prefix;
        rest = rest.slice(colonIdx + 1).trim();
      }
    }

    // Anchors are folio-only for v1 (matches the server parser).
    let anchor = "";
    if (type === "folio") {
      if (rest.startsWith("#")) {
        const second = rest.indexOf("#", 1);
        if (second !== -1) {
          anchor = rest.slice(second + 1).trim();
          rest = rest.slice(0, second);
        }
      } else {
        const hashIdx = rest.indexOf("#");
        if (hashIdx !== -1) {
          anchor = rest.slice(hashIdx + 1).trim();
          rest = rest.slice(0, hashIdx).trim();
        }
      }
    }

    if (type === "quest") {
      let quest: { shortId: number; title: string } | undefined;
      if (rest.startsWith("#")) {
        const n = Number.parseInt(rest.slice(1), 10);
        quest = Number.isFinite(n) ? questByShort.get(n) : undefined;
      } else {
        const hit = questByTitle.get(rest.toLowerCase().trim());
        if (hit && hit.count === 1) quest = hit.quest;
      }
      if (!quest) return `[[${body}]]`;
      const href = `/c/${campaignId}/q/${quest.shortId}`;
      const label = escapeMarkdownLabel(quest.title);
      return `[${label}](${href})`;
    }

    // Folio.
    let folio: Folio | undefined;
    if (rest.startsWith("#")) {
      const n = Number.parseInt(rest.slice(1), 10);
      folio = Number.isFinite(n) ? folioByShort.get(n) : undefined;
    } else {
      const hit = folioByTitle.get(rest.toLowerCase().trim());
      if (hit && hit.count === 1) folio = hit.folio;
    }
    if (!folio) return `[[${body}]]`;
    const href = anchor
      ? `/c/${campaignId}/folios/${folio.shortId}#${slugify(anchor)}`
      : `/c/${campaignId}/folios/${folio.shortId}`;
    const label = escapeMarkdownLabel(
      folio.title + (anchor ? ` § ${anchor}` : ""),
    );
    return `[${label}](${href})`;
  });
};

/**
 * Match the slug a typical markdown→HTML pipeline produces for a heading.
 * Lowercase, strip non-word chars (except hyphens), collapse whitespace
 * to dashes. The exact rule doesn't have to match `rehype-slug` perfectly
 * for v1 — the user can fall back to the folio root if the anchor misses.
 */
const slugify = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Escape characters that would break a markdown link label. Brackets are
 * the main concern; titles with literal `]` would terminate the label
 * early and leave the URL on the page as text.
 */
const escapeMarkdownLabel = (s: string): string =>
  s.replace(/[\\[\]]/g, (c) => `\\${c}`);
