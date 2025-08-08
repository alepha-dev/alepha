import { useClient, useRouter, useStore } from "@alepha/react";
import { Flex } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import { Button, ButtonGroup, Drawer } from "@blueprintjs/core";
import { useState } from "react";
import type { AppRouter } from "../../AppRouter.ts";
import type TaskApi from "../../api/TaskApi.ts";
import type { I18n } from "../../services/I18n.ts";
import Action from "../shared/Action.tsx";
import TaskCreate from "./task/TaskCreate.tsx";

const ProjectActions = () => {
	const [project] = useStore("project");
	const router = useRouter<AppRouter>();

	if (!project) {
		return null;
	}

	const opts = {
		params: { projectId: String(project.id) },
	};

	return (
		<Flex fill pad1 pad2h bordered shadow bg rounded>
			<ButtonGroup>
				<Action
					visibleText={"sm"}
					icon={"panel-table"}
					variant={"minimal"}
					text={"Board"}
					link={{ to: router.path("projectBoard", opts) }}
				/>
				<Action
					visibleText={"sm"}
					icon={"people"}
					variant={"minimal"}
					text={"Players"}
					link={{ to: router.path("projectPlayers", opts) }}
				/>
				<Action
					visibleText={"sm"}
					icon={"timeline-line-chart"}
					variant={"minimal"}
					text={"Analytics"}
					link={{ to: router.path("projectAnalytics", opts) }}
				/>
				<Action
					visibleText={"sm"}
					icon={"cog"}
					variant={"minimal"}
					text={"Settings"}
					link={{ to: router.path("projectSettings", opts) }}
				/>
			</ButtonGroup>
			<Flex fill />
			<CreateTaskButton />
		</Flex>
	);
};

export default ProjectActions;

const CreateTaskButton = () => {
	const [showDialog, setShowDialog] = useState(false);
	const { tr } = useI18n<I18n, "en">();
	const client = useClient<TaskApi>();

	const [project] = useStore("project");
	if (!project) {
		return null;
	}

	return (
		<Flex>
			<Action
				visibleText={"lg"}
				intent={"success"}
				disabled={!client.createTask.can()}
				icon="plus"
				onClick={() => setShowDialog(true)}
			>
				{tr("roadmap.header.addTask")}
			</Action>
			<Drawer
				isOpen={showDialog}
				onClose={() => setShowDialog(false)}
				className={"drawer"}
			>
				<Flex bg col bordered fill pad2>
					<Flex col style={{ height: 48 }}>
						<Flex>
							<Flex fill></Flex>
							<Flex>
								<Button
									variant={"minimal"}
									icon={"cross"}
									onClick={() => setShowDialog(false)}
								/>
							</Flex>
						</Flex>
					</Flex>
					<Flex pad2h>
						<Flex
							pad1
							card
							bordered
							wFill
							rounded
							style={{
								borderBottomLeftRadius: 0,
								borderBottomRightRadius: 0,
								borderBottom: 0,
							}}
						/>
					</Flex>
					<TaskCreate project={project} onSubmit={() => setShowDialog(false)} />
				</Flex>
			</Drawer>
		</Flex>
	);
};
