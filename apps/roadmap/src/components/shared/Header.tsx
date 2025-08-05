import { useRouterEvents } from "@alepha/react";
import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import { Button, Drawer } from "@blueprintjs/core";
import { useState } from "react";
import { type Task, tasks } from "../../providers/Db.ts";
import type { I18n } from "../../services/I18n.ts";
import QuestLog from "../home/QuestLog.tsx";
import Action from "./Action.tsx";
import HeaderActions from "./HeaderActions.tsx";
import StupidLogo from "./StupidLogo.tsx";

export interface HeaderProps {
	tasks: Array<Task>;
}

const Header = (props: HeaderProps) => {
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
							<MobileQuestLog tasks={props.tasks} />
							<Flex visible={"md"}>
								<StupidLogo />
							</Flex>
							<Flex col>
								<Text bold large>
									{tr("roadmap.title")}
								</Text>
							</Flex>
						</Flex>
					</Flex>
					<HeaderActions />
				</Flex>
			</Flex>
		</Flex>
	);
};

export default Header;

const MobileQuestLog = (props: HeaderProps) => {
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
						<QuestLog tasks={props.tasks} />
					</Flex>
				</Flex>
			</Drawer>
		</Flex>
	);
};
