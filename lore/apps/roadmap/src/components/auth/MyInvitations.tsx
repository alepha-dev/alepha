import { useAlepha, useClient } from "@alepha/react";
import {
	Badge,
	Button,
	Card,
	Flex,
	Group,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconMail, IconX } from "@tabler/icons-react";
import { useState } from "react";
import type { InvitationApi } from "../../api/InvitationApi.ts";
import type { ProjectApi } from "../../api/ProjectApi.ts";

export interface MyInvitationsProps {
	invitations: Array<{
		id: string;
		projectId: number;
		projectTitle: string;
		invitedBy: string;
		inviterName?: string;
		inviterEmail: string;
		status: "pending" | "accepted" | "rejected";
		createdAt: string;
	}>;
}

const MyInvitations = (props: MyInvitationsProps) => {
	const [invitations, setInvitations] = useState(props.invitations);
	const invitationApi = useClient<InvitationApi>();
	const projectApi = useClient<ProjectApi>();
	const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>(
		{},
	);
	const alepha = useAlepha();

	const handleAccept = async (invitationId: string) => {
		setLoadingStates((prev) => ({ ...prev, [invitationId]: true }));
		try {
			await invitationApi.acceptInvitation({
				params: { id: invitationId },
			});

			setInvitations(await invitationApi.getMyInvitations());
			alepha.state("user_projects", await projectApi.getMyProjects());

			notifications.show({
				title: "Invitation Accepted",
				message:
					"You have joined the project! A character has been created for you.",
				color: "green",
			});
		} catch (error: any) {
			notifications.show({
				title: "Error",
				message: error.message || "Failed to accept invitation",
				color: "red",
			});
		} finally {
			setLoadingStates((prev) => ({ ...prev, [invitationId]: false }));
		}
	};

	const handleReject = async (invitationId: string) => {
		setLoadingStates((prev) => ({ ...prev, [invitationId]: true }));
		try {
			await invitationApi.rejectInvitation({
				params: { id: invitationId },
			});

			setInvitations(await invitationApi.getMyInvitations());

			notifications.show({
				title: "Invitation Rejected",
				message: "The invitation has been declined.",
				color: "orange",
			});
		} catch (error: any) {
			notifications.show({
				title: "Error",
				message: error.message || "Failed to reject invitation",
				color: "red",
			});
		} finally {
			setLoadingStates((prev) => ({ ...prev, [invitationId]: false }));
		}
	};

	const pendingInvitations = invitations.filter(
		(inv) => inv.status === "pending",
	);
	const processedInvitations = invitations.filter(
		(inv) => inv.status !== "pending",
	);

	if (!invitations || invitations.length === 0) {
		return (
			<Flex bg={"var(--app-bg-color)"} flex={1} align="center" justify="center">
				<Stack align="center" gap="md">
					<IconMail size={48} opacity={0.5} />
					<Text c="dimmed" size="lg" ta="center">
						No invitations found
					</Text>
					<Text c="dimmed" size="sm" ta="center">
						When someone invites you to join their project, it will appear here.
					</Text>
				</Stack>
			</Flex>
		);
	}

	return (
		<Flex bg={"var(--app-bg-color)"} flex={1} p="lg">
			<Stack w="100%" maw={800}>
				<Group gap="sm" align="center">
					<IconMail size={24} />
					<Title order={2}>My Invitations</Title>
					<Badge variant="light" color="blue">
						{invitations.length}{" "}
						{invitations.length === 1 ? "invitation" : "invitations"}
					</Badge>
				</Group>

				{pendingInvitations.length > 0 && (
					<Stack gap="md">
						<Text size="lg" fw={500}>
							Pending Invitations
						</Text>
						{pendingInvitations.map((invitation) => (
							<Card
								key={invitation.id}
								shadow="sm"
								padding="lg"
								radius="md"
								withBorder
								style={{
									borderLeft: "4px solid var(--mantine-color-orange-6)",
								}}
							>
								<Stack gap="md">
									<Group justify="space-between" align="flex-start">
										<Stack gap="xs" flex={1}>
											<Group gap="sm">
												<Title order={4}>{invitation.projectTitle}</Title>
												<Badge variant="light" color="orange">
													Pending
												</Badge>
											</Group>
											<Text size="sm" c="dimmed">
												Invited by{" "}
												{invitation.inviterName || invitation.inviterEmail}
											</Text>
											<Text size="xs" c="dimmed">
												Received:{" "}
												{new Date(invitation.createdAt).toLocaleDateString()}
											</Text>
										</Stack>
									</Group>

									<Group gap="sm">
										<Button
											leftSection={<IconCheck size={16} />}
											color="green"
											onClick={() => handleAccept(invitation.id)}
											loading={loadingStates[invitation.id]}
											disabled={Object.values(loadingStates).some(Boolean)}
										>
											Accept
										</Button>
										<Button
											leftSection={<IconX size={16} />}
											variant="light"
											color="red"
											onClick={() => handleReject(invitation.id)}
											loading={loadingStates[invitation.id]}
											disabled={Object.values(loadingStates).some(Boolean)}
										>
											Reject
										</Button>
									</Group>
								</Stack>
							</Card>
						))}
					</Stack>
				)}

				{processedInvitations.length > 0 && (
					<Stack gap="md">
						<Text size="lg" fw={500}>
							Previous Invitations
						</Text>
						{processedInvitations.map((invitation) => (
							<Card
								key={invitation.id}
								shadow="sm"
								padding="lg"
								radius="md"
								withBorder
								style={{
									opacity: 0.7,
									borderLeft:
										invitation.status === "accepted"
											? "4px solid var(--mantine-color-green-6)"
											: "4px solid var(--mantine-color-red-6)",
								}}
							>
								<Group justify="space-between" align="flex-start">
									<Stack gap="xs" flex={1}>
										<Group gap="sm">
											<Title order={4}>{invitation.projectTitle}</Title>
											<Badge
												variant="light"
												color={
													invitation.status === "accepted" ? "green" : "red"
												}
											>
												{invitation.status === "accepted"
													? "Accepted"
													: "Rejected"}
											</Badge>
										</Group>
										<Text size="sm" c="dimmed">
											Invited by{" "}
											{invitation.inviterName || invitation.inviterEmail}
										</Text>
										<Text size="xs" c="dimmed">
											Received:{" "}
											{new Date(invitation.createdAt).toLocaleDateString()}
										</Text>
									</Stack>
								</Group>
							</Card>
						))}
					</Stack>
				)}
			</Stack>
		</Flex>
	);
};

export default MyInvitations;
