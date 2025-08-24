import { Card, Typography } from "@mantine/core";
import { IconEdit, IconMaximize } from "@tabler/icons-react";
import { useState } from "react";
import type { Task } from "../../../api/providers/Db.ts";
import { theme } from "../../../constants/theme.ts";
import Action from "../../ui/Action.tsx";

const TaskDescription = (props: { task: Task; onEdit: () => void }) => {
	const [fullscreen, setFullscreen] = useState(false);
	return (
		<Card
			withBorder
			bg={theme.colors.panel}
			className={"overflow-auto"}
			p={"sm"}
			px={"md"}
			radius={"md"}
			style={{
				paddingBottom: "var(--spacing)",
				height: fullscreen ? "100vh" : "auto",
				width: fullscreen ? "100vw" : "auto",
				position: fullscreen ? "fixed" : "relative",
				top: fullscreen ? 0 : "auto",
				left: fullscreen ? 0 : "auto",
				zIndex: fullscreen ? 1000 : "auto",
			}}
		>
			<Action
				px={"xs"}
				variant={"subtle"}
				onClick={() => props.onEdit()}
				style={{ right: 8 + 42, top: 8, position: "absolute" }}
			>
				<IconEdit size={theme.icon.size.md} />
			</Action>
			<Action
				px={"xs"}
				variant={"subtle"}
				onClick={() => setFullscreen(!fullscreen)}
				style={{ right: 8, top: 8, position: "absolute" }}
			>
				<IconMaximize size={theme.icon.size.md} />
			</Action>
			<Typography>
				<div
					// biome-ignore lint/security/noDangerouslySetInnerHtml: ...
					dangerouslySetInnerHTML={{
						__html: props.task.description,
					}}
				/>
			</Typography>
		</Card>
	);
};

export default TaskDescription;
