import { useInject, useStore } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { Flex, Text } from "@alepha/react-flex";
import { Popover } from "@blueprintjs/core";
import type { ReactNode } from "react";
import { Level } from "../../services/Level.ts";

const ExperienceBar = () => {
	const auth = useAuth();
	const [character] = useStore("character");
	const lvl = useInject(Level);

	if (!auth.user || !character) {
		return null;
	}

	const chunks: Array<ReactNode> = [];

	for (let i = 0; i < 20; i++) {
		chunks.push(
			<Flex bordered key={i} className={`experience-bar-chunk n${i}`} />,
		);
	}

	const level = lvl.getLevelByXp(character.xp);
	const max = lvl.getMaxXpForLevel(level);
	const current = lvl.getCurrentXpForLevel(level, character.xp);
	const percentage = Math.floor((current * 100) / max);

	return (
		<Flex pad1>
			<Flex
				fill
				style={{
					position: "relative",
				}}
			>
				<Flex bg style={{ width: "100%", height: 10 }} />

				<Flex
					className={"experience-bar-progress"}
					style={{ width: `${percentage}%` }}
				/>

				<Flex shadow wFill style={{ position: "absolute", height: "100%" }}>
					{chunks}
				</Flex>

				<Flex
					card
					bordered
					shadow
					className={"experience-bar-cursor"}
					style={{ left: `${percentage}%` }}
				/>

				<Flex fill center style={{ position: "absolute", left: 0, top: 0 }}>
					<Popover
						fill
						position={"top"}
						interactionKind={"hover"}
						hoverOpenDelay={1000}
						content={
							<Flex col pad1 style={{ maxWidth: 256 }}>
								<Text bold>Experience Bar</Text>
								<Text small>
									Shows your current experience progress towards the next level.
								</Text>
							</Flex>
						}
					>
						<Text className={"experience-bar-text"}>
							XP: {current}/{max}
						</Text>
					</Popover>
				</Flex>
			</Flex>
		</Flex>
	);
};

export default ExperienceBar;
