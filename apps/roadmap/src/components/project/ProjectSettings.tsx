import { useAlepha, useClient, useRouter, useStore } from "@alepha/react";
import { useI18n } from "@alepha/react-i18n";
import { Card, Flex, SimpleGrid, Stack, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import type { AppRouter } from "../../AppRouter.ts";
import type { ProjectApi } from "../../api/ProjectApi.ts";
import { theme } from "../../constants/theme.ts";
import type { I18n } from "../../services/I18n.ts";
import Action from "../ui/Action.tsx";
import ProjectUpdate from "./ProjectUpdate.tsx";

const ProjectSettings = () => {
	const alepha = useAlepha();
	const { tr } = useI18n<I18n, "en">();
	const projectApi = useClient<ProjectApi>();
	const router = useRouter<AppRouter>();
	const [project] = useStore("project");

	if (!project) {
		return null;
	}

	const openDeleteModal = () =>
		new Promise<boolean>((resolve) =>
			modals.openConfirmModal({
				id: "delete-campaign-modal",
				title: "Delete Campaign",
				centered: true,
				children: (
					<Text size="sm">Are you sure you want to delete this campaign?</Text>
				),
				labels: { cancel: "Cancel", confirm: "Delete Campaign" },
				confirmProps: { color: "red" },
				onClose: () => resolve(false),
				onCancel: () => resolve(false),
				onConfirm: () => resolve(true),
			}),
		);

	return (
		<Stack flex={1} p={"md"}>
			<Stack gap={"xs"}>
				<Text>{tr("project.settings.general.title")}</Text>
				<ProjectUpdate project={project} />
			</Stack>
			<Stack gap={"xs"}>
				<Text>{tr("project.settings.danger.title")}</Text>
				<Card
					radius={0}
					withBorder
					className={"shadow"}
					bg={theme.colors.card}
					p={"sm"}
				>
					<SimpleGrid
						cols={{
							base: 1,
							xs: 2,
						}}
					>
						<Stack gap={0}>
							<Text size={"sm"}>{tr("project.settings.actions.delete")}</Text>
							<Text size="xs" c={"dimmed"}>
								{tr("project.settings.actions.delete.helper")}
							</Text>
						</Stack>
						<Flex justify={"end"} align={"center"}>
							<Action
								flex={{
									base: 1,
									xs: "unset",
								}}
								color={"red"}
								onClick={async () => {
									const confirmed = await openDeleteModal();
									if (!confirmed) {
										return;
									}

									projectApi
										.deleteProjectById({
											params: { id: project.id },
										})
										.then(() => {
											alepha.state(
												"user.projects",
												(alepha.state("user.projects") ?? []).filter(
													(p) => p.id !== project.id,
												),
											);

											router.go("home");
										});
								}}
							>
								{tr("project.settings.actions.delete")}
							</Action>
						</Flex>
					</SimpleGrid>
				</Card>
			</Stack>
		</Stack>
	);
};

export default ProjectSettings;
