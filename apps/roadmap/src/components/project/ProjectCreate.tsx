import { t } from "@alepha/core";
import { useAlepha, useClient, useInject, useRouter } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { Flex, Text } from "@alepha/react-flex";
import { useForm } from "@alepha/react-form";
import { useI18n } from "@alepha/react-i18n";
import { Build, Tag } from "@blueprintjs/icons";
import { useMemo, useState } from "react";
import type { AppRouter } from "../../AppRouter.ts";
import type { ProjectApi } from "../../api/ProjectApi.ts";
import type { I18n } from "../../services/I18n.ts";
import { Toaster } from "../../services/Toaster.ts";
import Action from "../shared/Action.tsx";
import Control from "../shared/Control.tsx";

const ProjectCreate = () => {
	const client = useClient<ProjectApi>();
	const [loading, setLoading] = useState(false);
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
			title: t.string(),
			public: t.optional(t.boolean()),
		}),
		onError: (error) => {
			toaster.show(error.message, "danger");
		},
		handler: async (body) => {
			setLoading(true);

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

			alepha.state("user.projects", [
				...(alepha.state("user.projects") || []),
				project,
			]);

			setLoading(false);
		},
	});

	return (
		<Flex bg fill pad2>
			<Flex className={"container"} col pad2>
				<form onSubmit={form.onSubmit}>
					<Flex col pad2 gap2>
						<Flex col gap1>
							<Text large bold>
								{tr("project.create.title")}
							</Text>
							<Text muted>{tr("project.create.description")}</Text>
						</Flex>
						<Flex pad2 card bordered shadow rounded>
							<Flex pad2 gap4 col style={{ maxWidth: 600 }}>
								<Control
									inputField={form.input.title}
									inputGroupProps={{
										autoFocus: true,
										leftIcon: <Tag />,
									}}
									formGroupProps={{
										label: tr("project.create.name"),
										helperText: tr("project.create.name.helper"),
									}}
								/>
								<Control
									inputField={form.input.public}
									formGroupProps={{
										label: tr("project.create.public"),
										helperText: tr("project.create.public.helper"),
									}}
								/>
								<Flex>
									<Action
										size={"large"}
										intent={"success"}
										text={tr("project.create.submit")}
										icon={<Build />}
										loading={loading}
										type={"submit"}
									/>
								</Flex>
							</Flex>
						</Flex>
					</Flex>
				</form>
			</Flex>
		</Flex>
	);
};

export default ProjectCreate;
