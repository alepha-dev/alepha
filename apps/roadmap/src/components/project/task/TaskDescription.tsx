import { Flex } from "@alepha/react-flex";
import { useState } from "react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { Task } from "../../../providers/Db.ts";
import Action from "../../shared/Action.tsx";

const TaskDescription = (props: { task: Task }) => {
	const [fullscreen, setFullscreen] = useState(false);
	return (
		<Flex
			bg
			overflow
			bordered
			pad2
			rounded
			col
			style={{ position: "relative" }}
			className={"bp6-running-text"}
		>
			<Action
				variant={"minimal"}
				icon={"fullscreen"}
				style={{ right: 8, top: 8, position: "absolute" }}
			/>
			<Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
				{props.task.description}
			</Markdown>
		</Flex>
	);
};

export default TaskDescription;
