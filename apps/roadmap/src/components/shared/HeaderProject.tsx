import { useRouter, useRouterState, useStore } from "@alepha/react";
import { Flex, Menu } from "@mantine/core";
import { IconPlus, IconSquare, IconSquareCheck } from "@tabler/icons-react";
import type { AppRouter } from "../../AppRouter.ts";
import Action from "../ui/Action.tsx";

const HeaderProject = () => {
	const [project] = useStore("current_project");
	const router = useRouter<AppRouter>();
	const { params } = useRouterState();
	const [projects = []] = useStore("user.projects");

	if (!project) {
		return null;
	}

	const menuItem = (id: number, label: string) => {
		return (
			<Menu.Item
				key={id}
				leftSection={
					params.projectId === String(id) ? (
						<IconSquareCheck size={16} />
					) : (
						<IconSquare size={16} />
					)
				}
				onClick={() => router.go(`/p/${id}`)}
			>
				{label}
			</Menu.Item>
		);
	};

	return (
		<Flex visibleFrom={"sm"} gap={"xs"} align="center" justify="center">
			<Menu withArrow arrowSize={12} trigger="hover" position="bottom">
				<Menu.Target>
					<Action variant={"subtle"}>{project.title}</Action>
				</Menu.Target>
				<Menu.Dropdown>
					{projects.map((p) => menuItem(p.id, p.title))}
					<Menu.Divider />
					<Menu.Item
						leftSection={<IconPlus size={16} />}
						component="a"
						href={router.path("projectCreate")}
					>
						Create Campaign
					</Menu.Item>
				</Menu.Dropdown>
			</Menu>
		</Flex>
	);
};

export default HeaderProject;
