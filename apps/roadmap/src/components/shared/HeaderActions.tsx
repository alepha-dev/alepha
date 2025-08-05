import { useClient, useInject } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { Flex } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import { Button, Drawer, Menu, MenuItem, Popover } from "@blueprintjs/core";
import { useState } from "react";
import type TaskApi from "../../api/TaskApi.ts";
import type { I18n } from "../../services/I18n.ts";
import { Theme } from "../../services/Theme.ts";
import TaskCreate from "../task/TaskCreate.tsx";
import Action from "./Action.tsx";

const HeaderActions = () => {
	const theme = useInject(Theme);
	const { tr, setLang, lang, languages } = useI18n<I18n, "en">();

	return (
		<Flex gap1 center>
			<CreateTaskButton />
			<Popover
				position={"bottom"}
				content={
					<Menu>
						{languages.map((key) => (
							<MenuItem
								icon={lang === key ? "tick" : "blank"}
								key={key}
								text={tr(key)}
								onClick={() => {
									setLang(key);
								}}
							/>
						))}
					</Menu>
				}
			>
				<Button icon={"translate"} variant={"minimal"} />
			</Popover>
			<AuthButton />
			<Button
				icon={"moon"}
				variant={"minimal"}
				onClick={() => {
					theme.toggleColorScheme();
				}}
			></Button>
		</Flex>
	);
};

export default HeaderActions;

const CreateTaskButton = () => {
	const [showDialog, setShowDialog] = useState(false);
	const { tr } = useI18n<I18n, "en">();
	const client = useClient<TaskApi>();
	return (
		<Flex>
			<Action
				visibleText={"md"}
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
					<TaskCreate onSubmit={() => setShowDialog(false)} />
				</Flex>
			</Drawer>
		</Flex>
	);
};

const AuthButton = () => {
	const auth = useAuth();
	if (auth.user) {
		return (
			<Popover
				position={"bottom"}
				content={
					<Menu>
						<MenuItem
							text="Logout"
							icon="log-out"
							onClick={() => auth.logout()}
						/>
					</Menu>
				}
			>
				<Action
					visibleText={"md"}
					variant={"minimal"}
					icon="user"
					text={auth.user.name}
					endIcon={"caret-down"}
				/>
			</Popover>
		);
	}

	return (
		<Action
			variant={"minimal"}
			icon={"user"}
			text={"Sign in"}
			onClick={() => {
				auth.login();
			}}
		/>
	);
};
