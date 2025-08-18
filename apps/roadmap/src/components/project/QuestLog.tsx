import { useStore } from "@alepha/react";
import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import { InputGroup, Menu, MenuItem, Popover } from "@blueprintjs/core";
import {
	CollapseAll,
	ExpandAll,
	GitRepo,
	HighPriority,
	More,
	Search,
	Sort,
	SortAlphabetical,
} from "@blueprintjs/icons";
import type { I18n } from "../../services/I18n.ts";
import Action from "../shared/Action.tsx";
import TaskList from "./task/TaskList.tsx";

const QuestLog = () => {
	const [tasks = []] = useStore("tasks");
	const { tr } = useI18n<I18n, "en">();
	return (
		<Flex
			card
			rounded
			wFill
			shadow={2}
			bordered
			style={{
				position: "relative",
			}}
			col
			overflow
		>
			<Flex pad1 gap1>
				<Flex center pad1h col visible={"xl"}>
					<GitRepo size={24} />
				</Flex>
				<Flex shadow bg bordered rounded fill centerX>
					<Flex pad2h gap1 center>
						<Text small>{tr("quest-log.quests")}</Text>
						<Flex bordered style={{ padding: "0 4px" }} rounded>
							<Text small>{tasks.length}/25</Text>
						</Flex>
					</Flex>
					<Flex fill />
					<Flex pad1h>
						<Action disabled icon={<ExpandAll />} variant={"minimal"} />
						<Action disabled icon={<CollapseAll />} variant={"minimal"} />
						<Popover
							position={"bottom-left"}
							content={
								<Menu>
									<MenuItem
										text={"Sort by"}
										icon={<Sort />}
										popoverProps={{
											position: "right",
										}}
									>
										<MenuItem text={"Name"} icon={<SortAlphabetical />} />
										<MenuItem text={"Priority"} icon={<HighPriority />} />
									</MenuItem>
								</Menu>
							}
						>
							<Action disabled icon={<More />} variant={"minimal"} />
						</Popover>
					</Flex>
				</Flex>
			</Flex>
			<Flex pad1h>
				<InputGroup
					disabled={tasks.length === 0}
					placeholder={tr("quest-log.search")}
					fill
					leftIcon={<Search />}
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
