import { useInject } from "@alepha/react";
import {
	Avatar,
	Badge,
	Card,
	Flex,
	Group,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	IconCrown,
	IconStar,
	IconTrophy,
	IconUser,
	IconUsers,
} from "@tabler/icons-react";
import { CharacterInfo } from "../../services/CharacterInfo.ts";

export interface ProjectPlayersProps {
	players: Array<{
		id: number;
		userId: string;
		userName?: string;
		userEmail: string;
		userPicture?: string;
		xp: number;
		balance: number;
		owner: boolean;
		createdAt: string;
		updatedAt: string;
	}>;
}

const ProjectPlayers = (props: ProjectPlayersProps) => {
	const { players } = props;
	const characterInfo = useInject(CharacterInfo);

	return (
		<Flex flex={1} p="lg">
			<Stack w="100%" maw={800}>
				<Group gap="sm" align="center">
					<IconUsers size={24} />
					<Title order={2}>Players</Title>
					<Badge variant="light" color="blue">
						{players.length} {players.length === 1 ? "player" : "players"}
					</Badge>
				</Group>

				<Text c="dimmed" size="sm">
					All adventurers participating in this project
				</Text>

				{players.length === 0 ? (
					<Card shadow="sm" padding="xl" radius="md" withBorder>
						<Flex align="center" justify="center" direction="column" gap="md">
							<IconUsers size={48} opacity={0.5} />
							<Text c="dimmed" size="lg" ta="center">
								No players in this project yet
							</Text>
							<Text c="dimmed" size="sm" ta="center">
								Invite adventurers to join this quest!
							</Text>
						</Flex>
					</Card>
				) : (
					<Stack gap="md">
						{players.map((player) => {
							const level = characterInfo.getLevelByXp(player.xp);
							const gold = characterInfo.getGold(player.balance);
							const silver = characterInfo.getSilver(player.balance);

							return (
								<Card
									bg={"var(--card-bg-color)"}
									key={player.id}
									shadow="sm"
									padding="lg"
									radius="md"
									withBorder
								>
									<Group gap="lg" align="flex-start">
										<Avatar
											src={player.userPicture}
											size={60}
											radius="md"
											style={{
												border: player.owner
													? "2px solid var(--mantine-color-yellow-6)"
													: "2px solid var(--mantine-color-gray-4)",
											}}
										>
											<IconUser size={30} />
										</Avatar>

										<Stack gap="xs" flex={1}>
											<Group gap="sm" align="center">
												<Text fw={500} size="lg">
													{player.userName || "Anonymous User"}
												</Text>
												{player.owner && (
													<Badge
														variant="filled"
														color="yellow"
														leftSection={<IconCrown size={12} />}
													>
														Owner
													</Badge>
												)}
												<Badge variant="light" color="blue">
													Level {level}
												</Badge>
											</Group>

											<Text size="sm" c="dimmed">
												{player.userEmail}
											</Text>

											<Group gap="lg">
												<Group gap="xs">
													<IconStar size={16} />
													<Text size="sm" fw={500}>
														{player.xp.toLocaleString()} XP
													</Text>
												</Group>
												<Group gap="xs">
													<IconTrophy size={16} />
													<Text size="sm" fw={500} c="yellow.6">
														{gold}g {silver}s
													</Text>
												</Group>
											</Group>

											<Text size="xs" c="dimmed">
												Joined:{" "}
												{new Date(player.createdAt).toLocaleDateString()}
											</Text>
										</Stack>
									</Group>
								</Card>
							);
						})}
					</Stack>
				)}
			</Stack>
		</Flex>
	);
};

export default ProjectPlayers;
