import { useRouterEvents, useStore } from "@alepha/react";
import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import { Button, Drawer } from "@blueprintjs/core";
import { Cross, GitRepo } from "@blueprintjs/icons";
import { useState } from "react";
import type { I18n } from "../../services/I18n.ts";
import ProjectActions from "../project/ProjectActions.tsx";
import QuestLog from "../project/QuestLog.tsx";
import Action from "./Action.tsx";
import HeaderActions from "./HeaderActions.tsx";
import HeaderProject from "./HeaderProject.tsx";
import StupidLogo from "./StupidLogo.tsx";

const Header = () => {
	const { tr } = useI18n<I18n, "en">();

	return (
		<Flex col pad1 gap1 style={{ height: 54 }} centerY>
			<Flex wFill pad2h>
				<Flex fill gap1>
					<Flex center gap1>
						<MobileQuestLog />
						<Flex visible={"md"}>
							<StupidLogo />
						</Flex>
						<Flex col>
							<Action active={false} variant={"minimal"} href={"/"}>
								<Text bold>{tr("header.title")}</Text>
							</Action>
						</Flex>
						<HeaderProject />
					</Flex>
				</Flex>
				<Flex pad2h visible={"md"} className={"container header"}>
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
	);
};

export default Header;

const MobileQuestLog = () => {
	const [show, setShow] = useState(false);
	const [project] = useStore("project");

	useRouterEvents({
		onEnd: () => setShow(false),
	});

	if (!project) {
		return null;
	}

	return (
		<Flex hide={"md"}>
			<Action
				size={"large"}
				icon={<GitRepo />}
				variant={"minimal"}
				onClick={() => setShow(true)}
			/>
			<Drawer
				onClose={() => setShow(false)}
				position={"left"}
				className={"drawer"}
				isOpen={show}
			>
				<Flex bg col bordered fill pad1 overflow>
					<Flex center pad2h style={{ height: 48 }}>
						<Flex fill></Flex>
						<Flex>
							<Button
								variant={"minimal"}
								icon={<Cross />}
								onClick={() => setShow(false)}
							/>
						</Flex>
					</Flex>
					<QuestLog />
				</Flex>
			</Drawer>
		</Flex>
	);
};
