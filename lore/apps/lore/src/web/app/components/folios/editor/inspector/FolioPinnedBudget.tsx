import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import type { ReactElement } from "react";

import type { Folio } from "@/api/entities/folios.ts";

import { userFoliosAtom } from "../../../../atoms/userFoliosAtom.ts";
import type { I18n } from "../../../../services/I18n.ts";

export interface FolioPinnedBudgetProps {
  folio: Folio;
  /**
   * The folio's LIVE content — the same draft buffer the editor shows —
   * so the bar tracks unsaved typing rather than lagging behind the last
   * save, matching how the meta bar's word count already behaves.
   */
  content: string;
}

/**
 * Characters, not tokens: `project_context`'s actual budget
 * (`pinnedContentAtom.maxChars`, `PinnedFolioFolder.ts`) caps the SUM of
 * every pinned, non-protected folio's `content.length` at this many
 * characters. Ported from the deleted `FolioEditor.tsx`'s
 * `TokenEstimator` (`PINNED_CAP_CHARS = 8192`).
 */
const PINNED_CAP_CHARS = 8192;

/**
 * Abbreviate a character count as `1234` → `"1.2K"`, `8192` → `"8.2K"`.
 * Whole thousands drop the decimal (`5000` → `"5K"`).
 */
const formatCount = (chars: number): string => {
  if (chars < 1000) return String(chars);
  const rounded = Math.round(chars / 100) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}K`;
};

/**
 * The pinned-context budget footer — shown only for a pinned, non-protected
 * folio (see the "Why not protected folios" note below).
 *
 * The brief pairs `PINNED_CAP_CHARS = 8192` with "tokens estimated as
 * `Math.ceil(chars / 4)`" and a `6.1K / 8K` label in the same breath, but
 * those two don't reconcile: `8192` chars is `~8.2K` chars, while
 * `8192 / 4 = 2048` tokens is `~2K` tokens — a token-denominated numerator
 * held up against a char-denominated cap (mislabeled as if they were the
 * same unit) would show a bar roughly 4× fuller than reality, and would
 * only trip "over cap" once real usage was already 4× over. Since
 * `PinnedFolioFolder.ts` enforces the cap in CHARACTERS, this bar measures
 * in characters throughout — the only reading that makes the cap's own
 * `8K` sensible and keeps the bar honest. See the task report.
 *
 * Why not protected folios: `ProjectTools.ts`'s `project_context` handler
 * drops every protected folio from the pinned surface before the cap is
 * even applied ("their content is ciphertext and useless to the agent") —
 * a protected pinned folio contributes NOTHING to the real budget, so a
 * bar for it would be showing a number `project_context` never sends.
 */
const FolioPinnedBudget = (
  props: FolioPinnedBudgetProps,
): ReactElement | null => {
  const { tr } = useI18n<I18n, "en">();
  const [folios] = useStore(userFoliosAtom);

  if (!props.folio.pinned || props.folio.protected) return null;

  const otherPinned = folios.filter(
    (f) => f.pinned && !f.protected && f.id !== props.folio.id,
  );
  const ownChars = props.content.length;
  const otherChars = otherPinned.reduce((sum, f) => sum + f.content.length, 0);
  const totalChars = ownChars + otherChars;
  const overCap = totalChars > PINNED_CAP_CHARS;

  const ownPercent = Math.min(100, (ownChars / PINNED_CAP_CHARS) * 100);
  const otherPercent = Math.min(
    100 - ownPercent,
    (otherChars / PINNED_CAP_CHARS) * 100,
  );

  return (
    <div className="border-border flex flex-none flex-col gap-1.5 border-t px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-[10.5px] font-medium tracking-[0.1em] uppercase">
          {tr("folios.editor.pinned.title")}
        </span>
        <span
          className={
            overCap
              ? "folio-mono text-[11px] text-amber-600 tabular-nums dark:text-amber-400"
              : "folio-mono text-muted-foreground text-[11px] tabular-nums"
          }
        >
          {formatCount(totalChars)} / {formatCount(PINNED_CAP_CHARS)}
        </span>
      </div>

      <div className="bg-muted flex h-1.5 w-full overflow-hidden rounded-full">
        <div
          className="bg-primary h-full"
          style={{ width: `${ownPercent}%` }}
        />
        <div
          className="bg-muted-foreground h-full"
          style={{ width: `${otherPercent}%` }}
        />
      </div>

      <div className="text-muted-foreground flex flex-col gap-0.5 text-[11px]">
        <span>
          {tr("folios.editor.pinned.self", {
            args: [formatCount(ownChars)],
          })}
        </span>
        {otherPinned.length > 0 && (
          <span>
            {tr("folios.editor.pinned.others", {
              args: [String(otherPinned.length)],
            })}
          </span>
        )}
      </div>

      <p className="text-muted-foreground/80 text-[10px] italic">
        {tr("folios.editor.pinned.note")}
      </p>
    </div>
  );
};

export default FolioPinnedBudget;
