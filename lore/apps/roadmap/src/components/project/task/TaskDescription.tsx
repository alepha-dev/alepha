import { Flex } from "@alepha/react-flex";
import { useState } from "react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { Task } from "../../../api/providers/Db.ts";
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
			style={{
				paddingBottom: "var(--spacing)",
				height: fullscreen ? "100vh" : "auto",
				width: fullscreen ? "100vw" : "auto",
				position: fullscreen ? "fixed" : "relative",
				top: fullscreen ? 0 : "auto",
				left: fullscreen ? 0 : "auto",
				zIndex: fullscreen ? 1000 : "auto",
			}}
			className={"bp6-running-text"}
		>
			<Action
				variant={"minimal"}
				icon={"fullscreen"}
				onClick={() => setFullscreen(!fullscreen)}
				style={{ right: 8, top: 8, position: "absolute" }}
			/>
			<Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
				{props.task.description}
			</Markdown>
		</Flex>
	);
};

export default TaskDescription;
