import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import { currentCampaignCharacterAtom } from "../../atoms/currentCampaignCharacterAtom.ts";
import type { I18n } from "../../services/I18n.ts";

/**
 * Full-screen celebration overlay that fires when the current campaign's
 * character XP crosses a level threshold. Lives next to `ExperienceBar` and
 * runs in parallel with the bar's own 3-phase fill — both are triggered by
 * the same atom update.
 *
 * Notes:
 * - Detection is by level number, not Character object identity. First
 *   mount, campaign switch, or same-level XP gain are silent.
 * - Respects `prefers-reduced-motion`: a calmer fade replaces the scale/ring
 *   spectacle when the OS-level flag is on.
 * - The overlay shows the *new* level number alongside the LEVEL UP banner —
 *   the part players actually care about.
 */
const ANIMATION_MS = 3_000;
const REDUCED_MS = 1_500;

const LevelUpAnimation = () => {
  const { tr } = useI18n<I18n, "en">();
  const info = useInject(CharacterInfo);
  const [character] = useStore(currentCampaignCharacterAtom);
  const reducedMotion = useReducedMotion();

  const [activeLevel, setActiveLevel] = useState<number | null>(null);

  // Previously observed (campaignId, level) — fire only on a strict level
  // increase within the SAME campaign.
  const lastSeenRef = useRef<{ campaignId: number; level: number } | null>(
    null,
  );

  useEffect(() => {
    if (!character) {
      lastSeenRef.current = null;
      return;
    }

    const level = info.getLevelByXp(character.xp);
    const previous = lastSeenRef.current;
    lastSeenRef.current = { campaignId: character.campaignId, level };

    if (
      !previous ||
      previous.campaignId !== character.campaignId ||
      level <= previous.level
    ) {
      return;
    }

    setActiveLevel(level);
    const timeout = window.setTimeout(
      () => setActiveLevel(null),
      reducedMotion ? REDUCED_MS : ANIMATION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [character, info, reducedMotion]);

  return (
    <AnimatePresence>
      {activeLevel != null && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center gap-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {!reducedMotion && (
            <motion.div
              aria-hidden
              className="absolute size-60 rounded-full border-4 border-yellow-400 sm:size-72"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: [0, 1.2, 1], opacity: [0, 0.6, 0] }}
              transition={{ duration: 1.5, ease: "easeOut" }}
            />
          )}
          {!reducedMotion && (
            <motion.div
              aria-hidden
              className="absolute size-96 rounded-full bg-yellow-400/20 blur-3xl"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: [0, 1.4, 1.6], opacity: [0, 0.5, 0] }}
              transition={{ duration: 2, ease: "easeOut" }}
            />
          )}
          <motion.div
            className="relative text-4xl font-extrabold tracking-wider text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.8)] sm:text-5xl"
            initial={reducedMotion ? { opacity: 0 } : { scale: 0, opacity: 0 }}
            animate={
              reducedMotion
                ? { opacity: [0, 1, 0] }
                : { scale: [0, 1.5, 1], opacity: [0, 1, 0] }
            }
            transition={{ duration: reducedMotion ? 1.5 : 3 }}
          >
            {tr("xp.levelUp.title")}
          </motion.div>
          <motion.div
            className="relative text-lg font-semibold tracking-wide text-yellow-300/90 sm:text-xl"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: [0, 1, 1, 0], y: [10, 0, 0, -4] }}
            transition={{
              duration: reducedMotion ? 1.5 : 2.5,
              times: [0, 0.2, 0.8, 1],
            }}
          >
            {tr("xp.levelUp.subtitle", { args: [String(activeLevel)] })}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default LevelUpAnimation;
