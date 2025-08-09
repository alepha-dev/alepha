import { useRouter, useRouterState, useStore } from "@alepha/react";
import { Flex, Text } from "@alepha/react-flex";
import { Divider, Icon, Menu, MenuItem, Popover } from "@blueprintjs/core";
import type { AppRouter } from "../../AppRouter.ts";
import Action from "./Action.tsx";

const HeaderProject = () => {
	const [project] = useStore("project");
	const router = useRouter<AppRouter>();
	const { pathname } = useRouterState();
	const [projects = []] = useStore("user.projects");

	if (!project) {
		return null;
	}

	const menuItem = (id: number, label: string) => {
		return (
			<MenuItem
				key={id}
				intent={pathname.startsWith(`/p/${id}`) ? "primary" : "none"}
				icon={pathname.startsWith(`/p/${id}`) ? "tick-circle" : "blank"}
				text={label}
				onClick={() => router.go(`/p/${id}`)}
			/>
		);
	};

	return (
		<Flex gap1 center>
			<Icon icon={"slash"} />
			<Flex>
				<Popover
					position={"bottom"}
					minimal
					content={
						<Menu>
							{projects.map((p) => menuItem(p.id, p.title))}
							<Divider />
							<MenuItem
								text={"Add Project"}
								icon={"plus"}
								href={router.path("projectCreate")}
							/>
						</Menu>
					}
				>
					<Action variant={"minimal"}>
						<Text bold>{project.title}</Text>
					</Action>
				</Popover>
			</Flex>
		</Flex>
	);
};

export default HeaderProject;
