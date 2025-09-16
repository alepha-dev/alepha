import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import "./LevelUpAnimation.css";
import { useInject, useStore } from "@alepha/react";
import type { Character } from "../../providers/Db.ts";
import { CharacterInfo } from "../../services/CharacterInfo.ts";

export default function LevelUpAnimation() {
	const [active, setActive] = useState(false);
	const lastCharacter = useRef<Character | undefined>(undefined);
	const info = useInject(CharacterInfo);
	const [character] = useStore("current_project_character");

	useEffect(() => {
		if (character) {
			const level = info.getLevelByXp(character.xp);
			if (
				lastCharacter.current != null &&
				lastCharacter.current.projectId === character.projectId &&
				info.getLevelByXp(character.xp) >
					info.getLevelByXp(lastCharacter.current.xp)
			) {
				lastCharacter.current = character;
				setActive(true);
				const timeout = setTimeout(() => setActive(false), 3500);
				return () => clearTimeout(timeout);
			}
		}
		lastCharacter.current = character ?? undefined;
	}, [character]);

	return (
		<AnimatePresence>
			{active && (
				<motion.div
					className="levelup-overlay"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
				>
					<motion.div
						className="magic-circle"
						initial={{ scale: 0, rotate: 0, opacity: 0 }}
						animate={{ scale: [0, 1.2, 1], rotate: 360, opacity: 1 }}
						transition={{ duration: 1.5, ease: "easeOut" }}
					>
						<motion.div
							className="magic-aura"
							initial={{ scale: 0 }}
							animate={{ scale: [0, 1.5, 1], opacity: [0, 1, 0] }}
							transition={{ duration: 1.5 }}
						/>
					</motion.div>
					{[...Array(20)].map((_, i) => (
						<motion.div
							key={i}
							className="particle"
							initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
							animate={{
								x: Math.cos((i / 20) * 2 * Math.PI) * 200,
								y: Math.sin((i / 20) * 2 * Math.PI) * 200,
								opacity: 0,
								scale: 0,
							}}
							transition={{ duration: 1.5, delay: 0.2 }}
						/>
					))}
					<motion.div
						className="levelup-text"
						initial={{ scale: 0 }}
						animate={{ scale: [0, 1.5, 1], opacity: [0, 1, 0] }}
						transition={{ duration: 3.5 }}
					>
						LEVEL UP!
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
