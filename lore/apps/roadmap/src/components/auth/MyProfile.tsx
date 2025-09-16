import { useInject } from "@alepha/react";
import {
	Avatar,
	Badge,
	Card,
	Flex,
	Grid,
	Group,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	IconBrandGithub,
	IconBrandGoogle,
	IconCalendar,
	IconKey,
	IconMail,
	IconShield,
	IconTrophy,
	IconUser,
} from "@tabler/icons-react";
import type { User } from "../../providers/Db.ts";
import { CharacterInfo } from "../../services/CharacterInfo.ts";

export interface ProfileProps {
	user: User;
	characters: Array<{
		id: number;
		projectId: number;
		projectTitle: string;
		xp: number;
		balance: number;
		owner?: boolean;
		createdAt: string;
		updatedAt: string;
	}>;
	identities: Array<{
		id: string;
		provider: string;
		providerUserId: string;
		createdAt: string;
		updatedAt: string;
	}>;
}

const MyProfile = (props: ProfileProps) => {
	const { user, characters, identities } = props;
	const characterInfo = useInject(CharacterInfo);

	// Calculate user statistics
	const totalXP = characters.reduce((sum, char) => sum + char.xp, 0);
	const totalGold = characters.reduce(
		(sum, char) => sum + characterInfo.getGold(char.balance),
		0,
	);
	const averageLevel =
		characters.length > 0
			? Math.floor(
					characters.reduce(
						(sum, char) => sum + characterInfo.getLevelByXp(char.xp),
						0,
					) / characters.length,
				)
			: 0;
	const highestLevel =
		characters.length > 0
			? Math.max(
					...characters.map((char) => characterInfo.getLevelByXp(char.xp)),
				)
			: 0;

	const getProviderIcon = (provider: string) => {
		switch (provider) {
			case "google":
				return <IconBrandGoogle size={16} />;
			case "github":
				return <IconBrandGithub size={16} />;
			case "usernamePassword":
				return <IconKey size={16} />;
			default:
				return <IconUser size={16} />;
		}
	};

	const getProviderColor = (provider: string) => {
		switch (provider) {
			case "google":
				return "red";
			case "github":
				return "dark";
			case "usernamePassword":
				return "blue";
			default:
				return "gray";
		}
	};

	return (
		<Flex bg={"var(--app-bg-color)"} flex={1} p="lg">
			<Stack w="100%" maw={1000}>
				{/* Header Card */}
				<Card shadow="sm" padding="xl" radius="md" withBorder>
					<Group gap="xl" align="flex-start">
						<Avatar src={user.picture} size={120} radius="md">
							<IconUser size={60} />
						</Avatar>

						<Stack gap="md" flex={1}>
							<Stack gap="xs">
								<Title order={2}>{user.name || "Anonymous User"}</Title>
								<Group gap="sm">
									<IconMail size={16} />
									<Text c="dimmed">{user.email}</Text>
								</Group>
								<Group gap="sm">
									<IconCalendar size={16} />
									<Text c="dimmed">
										Member since {new Date(user.createdAt).toLocaleDateString()}
									</Text>
								</Group>
							</Stack>

							<Group gap="sm">
								{user.roles.map((role) => (
									<Badge
										key={role}
										variant="light"
										color={role === "admin" ? "red" : "blue"}
										leftSection={<IconShield size={12} />}
									>
										{role.charAt(0).toUpperCase() + role.slice(1)}
									</Badge>
								))}
							</Group>
						</Stack>
					</Group>
				</Card>

				<Grid>
					{/* Gaming Statistics */}
					<Grid.Col span={{ base: 12, md: 6 }}>
						<Card shadow="sm" padding="lg" radius="md" withBorder h="100%">
							<Stack gap="md">
								<Group gap="sm">
									<IconTrophy size={20} />
									<Title order={4}>Gaming Statistics</Title>
								</Group>

								<Stack gap="sm">
									<Group justify="space-between">
										<Text size="sm" fw={500}>
											Total Experience
										</Text>
										<Text size="sm" fw={600}>
											{totalXP.toLocaleString()} XP
										</Text>
									</Group>

									<Group justify="space-between">
										<Text size="sm" fw={500}>
											Total Gold
										</Text>
										<Text size="sm" c="yellow.6" fw={600}>
											{totalGold.toLocaleString()}g
										</Text>
									</Group>

									<Group justify="space-between">
										<Text size="sm" fw={500}>
											Active Characters
										</Text>
										<Text size="sm" fw={600}>
											{characters.length}
										</Text>
									</Group>

									<Group justify="space-between">
										<Text size="sm" fw={500}>
											Highest Level
										</Text>
										<Badge variant="light">Level {highestLevel}</Badge>
									</Group>

									{characters.length > 1 && (
										<Group justify="space-between">
											<Text size="sm" fw={500}>
												Average Level
											</Text>
											<Badge variant="light">Level {averageLevel}</Badge>
										</Group>
									)}
								</Stack>
							</Stack>
						</Card>
					</Grid.Col>

					{/* Account Security */}
					<Grid.Col span={{ base: 12, md: 6 }}>
						<Card shadow="sm" padding="lg" radius="md" withBorder h="100%">
							<Stack gap="md">
								<Group gap="sm">
									<IconShield size={20} />
									<Title order={4}>Account Security</Title>
								</Group>

								<Stack gap="sm">
									<Group justify="space-between">
										<Text size="sm" fw={500}>
											Connected Providers
										</Text>
										<Text size="sm" fw={600}>
											{identities.length}
										</Text>
									</Group>

									<Stack gap="xs">
										{identities.map((identity) => (
											<Group key={identity.id} justify="space-between">
												<Group gap="xs">
													{getProviderIcon(identity.provider)}
													<Text size="sm">
														{identity.provider === "usernamePassword"
															? "Password"
															: identity.provider.charAt(0).toUpperCase() +
																identity.provider.slice(1)}
													</Text>
												</Group>
												<Badge variant="light" size="xs">
													Active
												</Badge>
											</Group>
										))}
									</Stack>

									<Text size="xs" c="dimmed" mt="xs">
										Last updated:{" "}
										{new Date(user.updatedAt).toLocaleDateString()}
									</Text>
								</Stack>
							</Stack>
						</Card>
					</Grid.Col>
				</Grid>
			</Stack>
		</Flex>
	);
};

export default MyProfile;
