import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import { Icon, InputGroup, Menu, MenuItem, Popover } from "@blueprintjs/core";
import type { Task } from "../../providers/Db.ts";
import type { I18n } from "../../services/I18n.ts";
import Action from "../shared/Action.tsx";
import TaskList from "../task/TaskList.tsx";

export interface QuestLogProps {
	tasks: Task[];
}

const QuestLog = (props: QuestLogProps) => {
	const { tasks = [] } = props;
	const { tr } = useI18n<I18n, "en">();
	return (
		<Flex
			card
			rounded
			shadow={2}
			fill
			bordered
			style={{
				position: "relative",
				width: 300,
			}}
			col
		>
			<Flex pad1 gap1>
				<Flex center pad2h col>
					<Icon icon={"git-repo"} size={24} />
					<Text small bold>
						{tr("roadmap.quest-log.title")}
					</Text>
				</Flex>
				<Flex shadow bg bordered rounded fill centerX>
					<Flex pad2h gap1 center>
						<Text small>{tr("roadmap.quest-log.quests")}</Text>
						<Flex bordered style={{ padding: "0 4px" }} rounded>
							<Text small>{tasks.length}/25</Text>
						</Flex>
					</Flex>
					<Flex fill />
					<Flex pad1h>
						<Action
							disabled={tasks.length === 0}
							icon={"expand-all"}
							variant={"minimal"}
						/>
						<Action
							disabled={tasks.length === 0}
							icon={"collapse-all"}
							variant={"minimal"}
						/>
						<Popover
							position={"bottom-left"}
							content={
								<Menu>
									<MenuItem
										text={"Sort by"}
										icon={"sort"}
										popoverProps={{
											position: "right",
										}}
									>
										<MenuItem text={"Name"} icon={"sort-alphabetical"} />
										<MenuItem text={"Priority"} icon={"high-priority"} />
									</MenuItem>
								</Menu>
							}
						>
							<Action disabled icon={"more"} variant={"minimal"} />
						</Popover>
					</Flex>
				</Flex>
			</Flex>
			<Flex pad1h>
				<InputGroup
					disabled={tasks.length === 0}
					placeholder={tr("roadmap.quest-log.search")}
					fill
					leftIcon={"search"}
					round
				/>
			</Flex>
			<Flex col pad1 gap1 overflow>
				<TaskList tasks={tasks} />
			</Flex>
		</Flex>
	);
};

export default QuestLog;
