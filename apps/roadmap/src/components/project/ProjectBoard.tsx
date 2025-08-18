import { useInject, useStore } from "@alepha/react";
import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import { SymbolCircle } from "@blueprintjs/icons";
import { Level } from "../../services/Level.ts";

const ProjectBoard = () => {
	const [character] = useStore("character");
	const helper = useInject(Level);
	const i18n = useI18n();
	if (!character) {
		return null;
	}

	const gold = helper.getGold(character.balance);
	const silver = helper.getSilver(character.balance);
	const level = helper.getLevelByXp(character.xp);

	return (
		<Flex fill col>
			<Flex pad2 wFill>
				<Flex gap2 pad1 card bordered rounded shadow wFill>
					<Flex col fill center>
						<Flex gap1 center>
							<Text>Level</Text>
							<Text large={2}>{level}</Text>
						</Flex>
						<Flex>
							<Text small muted>
								{i18n.numberFormat.format(
									helper.getNextXpForLevel(character.xp),
								)}{" "}
								to next level
							</Text>
						</Flex>
					</Flex>
					<Flex gap2 fill center>
						<Flex center visible={"md"}>
							<Text small>CUR:</Text>
						</Flex>
						<Flex gap1>
							<Flex>
								{gold} <SymbolCircle color={"var(--color-gold)"} />
							</Flex>
							<Flex>
								{silver} <SymbolCircle color={"var(--color-silver)"} />
							</Flex>
						</Flex>
					</Flex>
				</Flex>
			</Flex>
		</Flex>
	);
};

export default ProjectBoard;
