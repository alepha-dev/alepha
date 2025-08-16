import { Flex } from "@alepha/react-flex";
import { Classes } from "@blueprintjs/core";
import { Edit, Fullscreen } from "@blueprintjs/icons";
import { useState } from "react";
import type { Task } from "../../../api/providers/Db.ts";
import Action from "../../shared/Action.tsx";

const TaskDescription = (props: { task: Task; onEdit: () => void }) => {
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
			className={Classes.RUNNING_TEXT}
		>
			<Action
				variant={"minimal"}
				icon={<Edit />}
				onClick={() => props.onEdit()}
				style={{ right: 8 + 32, top: 8, position: "absolute" }}
			/>
			<Action
				variant={"minimal"}
				icon={<Fullscreen />}
				onClick={() => setFullscreen(!fullscreen)}
				style={{ right: 8, top: 8, position: "absolute" }}
			/>
			<div
				// biome-ignore lint/security/noDangerouslySetInnerHtml: ...
				dangerouslySetInnerHTML={{
					__html: props.task.description,
				}}
			/>
		</Flex>
	);
};

export default TaskDescription;
