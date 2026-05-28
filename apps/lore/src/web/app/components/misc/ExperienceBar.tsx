import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useInject, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useRef, useState } from "react";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import { currentCampaignCharacterAtom } from "../../atoms/currentCampaignCharacterAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import LevelUpAnimation from "./LevelUpAnimation.tsx";

/**
 * Duration of each fill phase (ms). Tuned to feel like a celebration on
 * level-up without dragging on normal XP gains.
 */
const FILL_MS = 600;

/**
 * Small gap between the snap-to-0 and the resume-fill so React commits them
 * as separate paints — otherwise the browser may batch the two width updates
 * and skip the visible reset.
 */
const SNAP_GAP_MS = 80;

const ExperienceBar = () => {
  const auth = useAuth();
  const { tr } = useI18n<I18n, "en">();
  const [character] = useStore(currentCampaignCharacterAtom);
  const info = useInject(CharacterInfo);

  // Hooks must run unconditionally — keep state declarations above the
  // early-return guard. Default to safe values when no character is loaded.
  const xp = character?.xp ?? 0;
  const level = info.getLevelByXp(xp);
  const max = info.getMaxXpForLevel(level);
  const current = info.getCurrentXpForLevel(level, xp);
  const percentage = max > 0 ? Math.floor((current * 100) / max) : 100;

  // Bar fill state is driven by an effect so we can play a 3-phase animation
  // on level-up: fill to 100% on the old level → snap to 0% with transitions
  // off → animate forward to the new level's percentage. Without this the
  // bar would visibly shrink (e.g. 96% → 5%), reading as "XP loss".
  const [displayPct, setDisplayPct] = useState(percentage);
  const [animate, setAnimate] = useState(true);
  const prevLevelRef = useRef(level);

  useEffect(() => {
    const prevLevel = prevLevelRef.current;
    prevLevelRef.current = level;

    if (level <= prevLevel) {
      // First mount, same-level XP gain, or rollback — just animate.
      setAnimate(true);
      setDisplayPct(percentage);
      return;
    }

    // Level-up: phase 1 — fill to 100% on the old level.
    setAnimate(true);
    setDisplayPct(100);
    // Phase 2 — once the fill is done, snap to 0% with animation off.
    const snap = window.setTimeout(() => {
      setAnimate(false);
      setDisplayPct(0);
    }, FILL_MS);
    // Phase 3 — re-enable animation and fill to the new percentage.
    const fill = window.setTimeout(() => {
      setAnimate(true);
      setDisplayPct(percentage);
    }, FILL_MS + SNAP_GAP_MS);
    return () => {
      window.clearTimeout(snap);
      window.clearTimeout(fill);
    };
  }, [level, percentage]);

  if (!auth.user || !character) {
    return null;
  }

  return (
    <>
      <LevelUpAnimation />
      <div className="p-2">
        <div className="relative flex h-3 w-full items-center">
          <div className="h-2.5 w-full overflow-hidden rounded-full border border-border bg-muted">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-violet-500"
              style={{
                width: `${displayPct}%`,
                transition: animate ? `width ${FILL_MS}ms ease-out` : "none",
              }}
            />
          </div>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="pointer-events-auto cursor-help rounded bg-black/55 px-1.5 py-px text-[10px] font-medium text-white" />
                }
              >
                XP: {current}/{max}
              </TooltipTrigger>
              <TooltipContent side="top">
                <div className="flex max-w-64 flex-col">
                  <span className="font-medium">{tr("xp.bar.title")}</span>
                  <span className="text-sm">{tr("xp.bar.description")}</span>
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </>
  );
};

export default ExperienceBar;
