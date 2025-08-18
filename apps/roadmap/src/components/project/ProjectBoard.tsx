import { useInject, useRouter, useStore } from "@alepha/react";
import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import {
	ButtonGroup,
	Divider,
	HTMLSelect,
	HTMLTable,
	InputGroup,
	Tag,
} from "@blueprintjs/core";
import {
	CloudTick,
	Dot,
	FilterRemove,
	Menu,
	More,
	PolygonFilter,
	Search,
	Sort,
	SymbolCircle,
} from "@blueprintjs/icons";
import type { AppRouter } from "../../AppRouter.ts";
import { Level } from "../../services/Level.ts";
import Action from "../shared/Action.tsx";

const ProjectBoard = () => {
	const [character] = useStore("character");
	const [tasks = []] = useStore("tasks");
	const helper = useInject(Level);
	const router = useRouter<AppRouter>();
	const i18n = useI18n();
	if (!character) {
		return null;
	}

	const gold = helper.getGold(character.balance);
	const silver = helper.getSilver(character.balance);
	const level = helper.getLevelByXp(character.xp);

	return (
		<Flex fill col pad2 gap2>
			<Flex wFill>
				<Flex gap2 pad1 card bordered rounded shadow wFill>
					<Flex col fill center>
						<Flex gap1 center>
							<Text>Level</Text>
							<Text large={2}>{level}</Text>
						</Flex>
						<Flex>
							<Text small muted>
								{i18n.numberFormat.format(
									helper.getNextXpForLevel(character.xp),
								)}{" "}
								to next level
							</Text>
						</Flex>
					</Flex>
					<Flex gap2 fill center>
						<Flex center visible={"md"}>
							<Text small>CUR:</Text>
						</Flex>
						<Flex gap1>
							<Flex>
								{gold} <SymbolCircle color={"var(--color-gold)"} />
							</Flex>
							<Flex>
								{silver} <SymbolCircle color={"var(--color-silver)"} />
							</Flex>
						</Flex>
					</Flex>
				</Flex>
			</Flex>
			<Flex gap1 wFill col>
				<Flex pad2h>
					<Flex bordered card rounded>
						<ButtonGroup>
							<Action variant={"minimal"} icon={<PolygonFilter />} />
							<Action variant={"minimal"} icon={<CloudTick />} />
							<Divider />
							<Flex center>
								<InputGroup leftElement={<Search />} size={"small"} />
							</Flex>
							<Divider />
							<HTMLSelect minimal>
								<option value="all">Zone</option>
							</HTMLSelect>
							<Divider />
							<Action variant={"minimal"} icon={<FilterRemove />} />
						</ButtonGroup>
					</Flex>
				</Flex>
				<Flex bordered shadow rounded bg wFill>
					<HTMLTable width={"100%"} bordered compact>
						<thead>
							<tr>
								<th>
									<Action
										alignText={"left"}
										fill
										variant={"minimal"}
										endIcon={<Sort />}
									>
										Quest
									</Action>
								</th>
								<th>
									<Action
										alignText={"left"}
										fill
										variant={"minimal"}
										endIcon={<Sort />}
									>
										Priority
									</Action>
								</th>
								<th>
									<Action
										alignText={"left"}
										fill
										variant={"minimal"}
										endIcon={<Sort />}
									>
										Difficulty
									</Action>
								</th>
								<th>
									<Action
										alignText={"left"}
										fill
										variant={"minimal"}
										endIcon={<Sort />}
									>
										Created At
									</Action>
								</th>
								<th>
									<Action
										alignText={"left"}
										fill
										variant={"minimal"}
										endIcon={<Sort />}
									>
										Completed At
									</Action>
								</th>
							</tr>
						</thead>
						<tbody>
							{tasks.map((task) => (
								<Flex
									card
									tr
									key={task.id}
									onClick={() => {
										router.go("projectTask", {
											params: { taskId: String(task.id) },
										});
									}}
								>
									<td>{task.title}</td>
									<td>
										<Tag intent={"primary"} minimal>
											{task.priority}
										</Tag>
									</td>
									<td>{task.complexity}</td>
									<td>{new Date(task.createdAt).toLocaleDateString()}</td>
									<td>
										{task.completedAt
											? new Date(task.completedAt).toLocaleDateString()
											: "Not completed"}
									</td>
								</Flex>
							))}
						</tbody>
					</HTMLTable>
				</Flex>
			</Flex>
		</Flex>
	);
};

export default ProjectBoard;
