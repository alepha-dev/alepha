import { useInject } from "@alepha/react";
import {
	Badge,
	Card,
	Flex,
	Group,
	HoverCard,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import type { ReactNode } from "react";
import { theme } from "../../constants/theme.ts";
import { CharacterInfo } from "../../services/CharacterInfo.ts";

export interface MyCharactersProps {
	characters: Array<{
		id: number;
		projectId: number;
		projectTitle: string;
		xp: number;
		balance: number;
		createdAt: string;
		updatedAt: string;
	}>;
}

const CharacterXPBar = ({
	character,
	characterInfo,
}: {
	character: {
		id: number;
		projectId: number;
		projectTitle: string;
		xp: number;
		balance: number;
		createdAt: string;
		updatedAt: string;
	};
	characterInfo: CharacterInfo;
}) => {
	const level = characterInfo.getLevelByXp(character.xp);
	const maxXp = characterInfo.getMaxXpForLevel(level);
	const currentXp = characterInfo.getCurrentXpForLevel(level, character.xp);
	const percentage = Math.floor((currentXp * 100) / maxXp);

	// Create chunks for visual appeal (fewer than the main experience bar)
	const chunks: Array<ReactNode> = [];
	for (let i = 0; i < 12; i++) {
		chunks.push(
			<Card
				bg="transparent"
				withBorder
				radius={0}
				p={0}
				key={i}
				style={{
					flex: 1,
					height: "100%",
					borderColor: "var(--mantine-color-gray-4)",
				}}
			/>,
		);
	}

	return (
		<Stack gap="xs">
			<Group justify="space-between">
				<Text size="sm" fw={500}>
					Experience Progress
				</Text>
				<Text size="sm" c="dimmed">
					{currentXp} / {maxXp} XP
				</Text>
			</Group>

			<Flex
				style={{
					position: "relative",
					height: 10,
				}}
			>
				{/* Background */}
				<Card
					p={0}
					bg={theme.colors.panel}
					style={{
						width: "100%",
						height: "100%",
						borderRadius: "8px",
					}}
				/>

				{/* Progress Fill */}
				<Flex
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						height: "100%",
						width: `${percentage}%`,
						background: "linear-gradient(90deg, #4dabf7 0%, #339af0 100%)",
						borderRadius: "8px",
						transition: "width 0.3s ease",
					}}
				/>

				{/* Chunks overlay */}
				<Flex
					w="100%"
					style={{
						position: "absolute",
						height: "100%",
						borderRadius: "8px",
						overflow: "hidden",
					}}
				>
					{chunks}
				</Flex>

				{/* Progress cursor */}
				<Card
					withBorder
					p={0}
					style={{
						position: "absolute",
						left: `${percentage}%`,
						top: -2,
						width: 4,
						height: 10 + 4,
						backgroundColor: "var(--mantine-color-blue-6)",
						borderColor: "var(--mantine-color-blue-7)",
						borderRadius: "2px",
						transform: "translateX(-50%)",
						zIndex: 10,
					}}
				/>

				{/* Hover card for detailed info */}
				<HoverCard openDelay={500} position="top">
					<HoverCard.Target>
						<Flex
							style={{
								position: "absolute",
								left: 0,
								top: 0,
								right: 0,
								bottom: 0,
								cursor: "help",
							}}
						/>
					</HoverCard.Target>
					<HoverCard.Dropdown>
						<Stack gap="xs" style={{ maxWidth: 200 }}>
							<Text size="sm" fw={500}>
								Character Progress
							</Text>
							<Text size="xs">
								Level {level} ({percentage}% to next level)
							</Text>
							<Text size="xs" c="dimmed">
								{currentXp} / {maxXp} XP needed for Level {level + 1}
							</Text>
						</Stack>
					</HoverCard.Dropdown>
				</HoverCard>
			</Flex>
		</Stack>
	);
};

const MyCharacters = (props: MyCharactersProps) => {
	const { characters } = props;
	const characterInfo = useInject(CharacterInfo);

	if (!characters || characters.length === 0) {
		return (
			<Flex bg={"var(--app-bg-color)"} flex={1} align="center" justify="center">
				<Text c="dimmed" size="lg">
					No characters found. Join a project to create your first character!
				</Text>
			</Flex>
		);
	}

	return (
		<Flex bg={"var(--app-bg-color)"} flex={1} p="lg">
			<Stack w="100%" maw={800}>
				<Title order={2}>My Characters</Title>

				{characters.map((character) => {
					const level = characterInfo.getLevelByXp(character.xp);
					const gold = characterInfo.getGold(character.balance);
					const silver = characterInfo.getSilver(character.balance);
					const rank = characterInfo.getRank(level);

					return (
						<Card
							key={character.id}
							shadow="sm"
							padding="lg"
							radius="md"
							withBorder
						>
							<Stack gap="md">
								<Group justify="space-between" align="flex-start">
									<Stack gap="xs">
										<Group gap="sm">
											<Title order={4}>{character.projectTitle}</Title>
											<Badge variant="light" color="blue">
												Level {level}
											</Badge>
											<Badge
												variant="light"
												color={
													rank === "S"
														? "purple"
														: rank === "A"
															? "red"
															: rank === "B"
																? "orange"
																: rank === "C"
																	? "yellow"
																	: "gray"
												}
											>
												Rank {rank}
											</Badge>
										</Group>
										<Text size="sm" c="dimmed">
											Created:{" "}
											{new Date(character.createdAt).toLocaleDateString()}
										</Text>
									</Stack>
									<Group gap="md">
										<Stack gap={0} align="center">
											<Text size="sm" fw={500} c="yellow.6">
												💰 {gold}g {silver}s
											</Text>
											<Text size="xs" c="dimmed">
												Balance
											</Text>
										</Stack>
									</Group>
								</Group>

								<CharacterXPBar
									character={character}
									characterInfo={characterInfo}
								/>
							</Stack>
						</Card>
					);
				})}
			</Stack>
		</Flex>
	);
};

export default MyCharacters;
