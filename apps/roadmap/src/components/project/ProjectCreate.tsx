import { t } from "@alepha/core";
import { useAlepha, useClient, useInject, useRouter } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { useForm } from "@alepha/react-form";
import { useI18n } from "@alepha/react-i18n";
import { Card, Container, Flex, Stack, Text } from "@mantine/core";
import { IconHammer, IconTag } from "@tabler/icons-react";
import { useMemo } from "react";
import type { AppRouter } from "../../AppRouter.ts";
import type { ProjectApi } from "../../api/ProjectApi.ts";
import { theme } from "../../constants/theme.ts";
import type { I18n } from "../../services/I18n.ts";
import { Toaster } from "../../services/Toaster.ts";
import Action from "../ui/Action.tsx";
import Control from "../ui/Control.tsx";

const ProjectCreate = () => {
	const client = useClient<ProjectApi>();
	const router = useRouter<AppRouter>();
	const auth = useAuth();
	const alepha = useAlepha();
	const { tr } = useI18n<I18n, "en">();
	const toaster = useInject(Toaster);

	const initialValues = useMemo(() => {
		try {
			if (router.query.b) {
				return JSON.parse(decodeURIComponent(router.query.b));
			}
		} catch (e) {
			// ignore
		}
	}, []);

	const form = useForm({
		initialValues,
		schema: t.object({
			title: t.string({
				minLength: 3,
				maxLength: 24,
			}),
			public: t.optional(t.boolean()),
		}),
		onError: (error) => {
			toaster.show(error.message, "danger");
		},
		handler: async (body) => {
			if (!auth.user) {
				await router.go("login", {
					query: {
						r: router.path("projectCreate", {
							query: {
								b: encodeURIComponent(JSON.stringify(body)),
							},
						}),
					},
				});
				return;
			}

			const project = await client.createProject({ body });

			await router.go("project", {
				params: { projectId: String(project.id) },
			});

			alepha.state.set("user_projects", [
				...(alepha.state.get("user_projects") || []),
				project,
			]);
		},
	});

	return (
		<Card
			withBorder
			flex={1}
			radius={0}
			p={"sm"}
			bg={theme.colors.panel}
			style={{
				borderLeft: 0,
				borderRight: 0,
			}}
		>
			<Container w={theme.container}>
				<form onSubmit={form.onSubmit} noValidate>
					<Stack p={"lg"}>
						<Stack gap={0}>
							<Text size="lg" fw={"bold"}>
								{tr("project.create.title")}
							</Text>
							<Text size={"sm"} c={"dimmed"}>
								{tr("project.create.description")}
							</Text>
						</Stack>
						<Card
							withBorder
							radius={"md"}
							p={"sm"}
							bg={theme.colors.card}
							shadow={"md"}
						>
							<Stack p={"sm"} style={{ maxWidth: 600 }} gap={"xl"}>
								<Control
									input={form.input.title}
									text={{
										autoFocus: true,
									}}
									icon={<IconTag />}
									title={tr("project.create.name")}
									description={tr("project.create.name.helper")}
								/>
								<Control
									input={form.input.public}
									title={tr("project.create.public")}
									description={tr("project.create.public.helper")}
								/>
								<Flex>
									<Action
										leftSection={<IconHammer />}
										form={form}
										variant={"filled"}
										color={"green"}
									>
										{tr("project.create.submit")}
									</Action>
								</Flex>
							</Stack>
						</Card>
					</Stack>
				</form>
			</Container>
		</Card>
	);
};

export default ProjectCreate;
