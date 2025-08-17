import { useRouter, useRouterState, useStore } from "@alepha/react";
import { Flex, Text } from "@alepha/react-flex";
import { Divider, Menu, MenuItem, Popover } from "@blueprintjs/core";
import { Blank, Plus, Slash, TickCircle } from "@blueprintjs/icons";
import type { AppRouter } from "../../AppRouter.ts";
import Action from "./Action.tsx";

const HeaderProject = () => {
	const [project] = useStore("project");
	const router = useRouter<AppRouter>();
	const { url } = useRouterState();
	const [projects = []] = useStore("user.projects");

	if (!project) {
		return null;
	}

	const menuItem = (id: number, label: string) => {
		return (
			<MenuItem
				key={id}
				intent={url.pathname.startsWith(`/p/${id}`) ? "primary" : "none"}
				icon={url.pathname.startsWith(`/p/${id}`) ? <TickCircle /> : <Blank />}
				text={label}
				onClick={() => router.go(`/p/${id}`)}
			/>
		);
	};

	return (
		<Flex gap1 center>
			<Slash />
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
								icon={<Plus />}
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
