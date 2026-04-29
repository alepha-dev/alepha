import { useInject, useStore } from "alepha/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { Character } from "@/api/entities/characters.ts";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import { currentProjectCharacterAtom } from "../../atoms/currentProjectCharacterAtom.ts";

const LevelUpAnimation = () => {
  const [active, setActive] = useState(false);
  const lastCharacter = useRef<Character | undefined>(undefined);
  const info = useInject(CharacterInfo);
  const [character] = useStore(currentProjectCharacterAtom);

  useEffect(() => {
    if (character) {
      if (
        lastCharacter.current != null &&
        lastCharacter.current.projectId === character.projectId &&
        info.getLevelByXp(character.xp) >
          info.getLevelByXp(lastCharacter.current.xp)
      ) {
        lastCharacter.current = character;
        setActive(true);
        const timeout = setTimeout(() => setActive(false), 3000);
        return () => clearTimeout(timeout);
      }
    }
    lastCharacter.current = character ?? undefined;
  }, [character]);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-[1000] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute size-72 rounded-full border-4 border-yellow-400"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.2, 1], opacity: [0, 0.6, 0] }}
            transition={{ duration: 1.5, ease: "easeOut" }}
          />
          <motion.div
            className="text-5xl font-extrabold tracking-wider text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.8)]"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.5, 1], opacity: [0, 1, 0] }}
            transition={{ duration: 3 }}
          >
            LEVEL UP!
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default LevelUpAnimation;
