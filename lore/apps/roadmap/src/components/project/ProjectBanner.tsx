import { useInject, useRouter, useStore } from "@alepha/react";
import { useI18n } from "@alepha/react-i18n";
import { Card, Flex, Stack, Text } from "@mantine/core";
import { IconCircleFilled, IconMoneybag } from "@tabler/icons-react";
import type { AppRouter } from "../../AppRouter.ts";
import { theme } from "../../constants/theme.ts";
import { CharacterInfo } from "../../services/CharacterInfo.ts";
import Action from "../ui/Action.tsx";

const ProjectBanner = () => {
	const [character] = useStore("current_project_character");
	const [project] = useStore("current_project");
	const helper = useInject(CharacterInfo);
	const router = useRouter<AppRouter>();
	const i18n = useI18n();
	if (!character) {
		return null;
	}

	const gold = helper.getGold(character.balance);
	const silver = helper.getSilver(character.balance);
	const level = helper.getLevelByXp(character.xp);

	return (
		<Card
			p={"xs"}
			withBorder
			w={"100%"}
			className={"shadow"}
			bg={theme.colors.card}
			radius={"md"}
		>
			<Flex gap={"sm"} w={"100%"}>
				<Stack gap={0} flex={1} align="center" justify="center">
					<Flex gap={"xs"} align="center" justify="center">
						<Text>Level {level}</Text>
					</Flex>
					<Text size="xs" c={"dimmed"}>
						{i18n.numberFormat.format(helper.getNextXpForLevel(character.xp))}{" "}
						to next level
					</Text>
				</Stack>
				<Action
					variant="subtle"
					flex={1}
					h="auto"
					p="xs"
					href={router.path("projectShop", {
						params: { projectId: project?.id ?? 0 },
					})}
				>
					<Flex gap={"sm"} align="center" justify="center" w="100%">
						<Flex align="center" justify="center" visibleFrom={"md"}>
							<IconMoneybag size={theme.icon.size.md} />
						</Flex>
						<Flex gap={"xs"} align={"center"}>
							<Flex align={"center"} gap={2}>
								<Text size={"sm"}>{gold}</Text>
								<IconCircleFilled
									color={"var(--color-gold)"}
									size={theme.icon.size.xs}
								/>
							</Flex>
							<Flex align={"center"} gap={2}>
								<Text size={"sm"}>{silver}</Text>
								<IconCircleFilled
									color={"var(--color-silver)"}
									size={theme.icon.size.xs}
								/>
							</Flex>
						</Flex>
					</Flex>
				</Action>
			</Flex>
		</Card>
	);
};

export default ProjectBanner;
