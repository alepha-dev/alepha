import {
	useRouter,
	useRouterEvents,
	useRouterState,
	useStore,
} from "@alepha/react";
import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import {
	Button,
	Divider,
	Drawer,
	Icon,
	Menu,
	MenuItem,
	Popover,
} from "@blueprintjs/core";
import { useState } from "react";
import type { I18n } from "../../services/I18n.ts";
import ProjectActions from "../project/ProjectActions.tsx";
import QuestLog from "../project/QuestLog.tsx";
import Action from "./Action.tsx";
import HeaderActions from "./HeaderActions.tsx";
import StupidLogo from "./StupidLogo.tsx";

const Header = () => {
	const { tr } = useI18n<I18n, "en">();

	return (
		<Flex col>
			<Flex
				visible={"md"}
				pad1
				card
				bordered
				style={{
					borderTop: 0,
					borderLeft: 0,
					borderRight: 0,
				}}
			></Flex>
			<Flex
				bordered
				centerY
				style={{
					height: 58,
					borderTop: 0,
					borderLeft: 0,
					borderRight: 0,
				}}
				col
				pad1
				gap1
			>
				<Flex wFill pad2h>
					<Flex fill gap1>
						<Flex center gap1>
							<MobileQuestLog />
							<Flex visible={"md"}>
								<StupidLogo />
							</Flex>
							<Flex col>
								<Action active={false} variant={"minimal"} href={"/"}>
									<Text bold large>
										{tr("roadmap.title")}
									</Text>
								</Action>
							</Flex>
							<HeaderProject />
						</Flex>
					</Flex>
					<Flex pad2h visible={"md"} className={"container"}>
						<Flex fill col>
							<ProjectActions />
						</Flex>
					</Flex>
					<Flex fill>
						<Flex fill />
						<HeaderActions />
					</Flex>
				</Flex>
			</Flex>
		</Flex>
	);
};

export default Header;

const HeaderProject = () => {
	const [project] = useStore("project");
	const router = useRouter();
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
							<MenuItem text={"Add Project"} icon={"plus"} />
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

const MobileQuestLog = () => {
	const [show, setShow] = useState(false);

	useRouterEvents({
		onEnd: () => setShow(false),
	});

	return (
		<Flex hide={"md"}>
			<Action icon={"menu"} variant={"minimal"} onClick={() => setShow(true)} />
			<Drawer
				onClose={() => setShow(false)}
				position={"left"}
				className={"drawer"}
				isOpen={show}
			>
				<Flex bg col bordered fill pad1>
					<Flex center pad2h style={{ height: 48 }}>
						<Flex fill></Flex>
						<Flex>
							<Button
								variant={"minimal"}
								icon={"cross"}
								onClick={() => setShow(false)}
							/>
						</Flex>
					</Flex>
					<Flex fill>
						<QuestLog />
					</Flex>
				</Flex>
			</Drawer>
		</Flex>
	);
};
