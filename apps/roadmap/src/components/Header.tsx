import { useClient, useInject } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import {
	Button,
	Drawer,
	Icon,
	Menu,
	MenuItem,
	Popover,
} from "@blueprintjs/core";
import { useState } from "react";
import type TaskApi from "../api/TaskApi.ts";
import type { I18n } from "../services/I18n.ts";
import { Theme } from "../services/Theme.ts";
import TaskCreate from "./TaskCreate.tsx";

const Header = () => {
	const theme = useInject(Theme);
	const { tr, setLang, lang, languages } = useI18n<I18n, "en">();

	return (
		<Flex
			bordered
			style={{
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
						<Icon icon={"route"} />
						<Text large>{tr("roadmap.title")}</Text>
					</Flex>
				</Flex>
				<Flex gap2 center>
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

					<AddTask />
					<Button
						icon={"moon"}
						variant={"minimal"}
						onClick={() => {
							theme.toggleColorScheme();
						}}
					></Button>
				</Flex>
			</Flex>
		</Flex>
	);
};

export default Header;

const AddTask = () => {
	const [showDialog, setShowDialog] = useState(false);
	const { tr } = useI18n<I18n, "en">();
	const client = useClient<TaskApi>();
	return (
		<Flex>
			<Button
				disabled={!client.createTask.can()}
				icon="add"
				variant={"outlined"}
				onClick={() => setShowDialog(true)}
			>
				{tr("roadmap.header.addTask")}
			</Button>
			<Drawer isOpen={showDialog} onClose={() => setShowDialog(false)}>
				<Flex bg col bordered fill pad2>
					<Flex col style={{ height: 64 }}>
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

	return (
		<Button
			icon={auth.user ? "log-out" : "log-in"}
			onClick={() => {
				if (auth.user) {
					auth.logout();
				} else {
					auth.login();
				}
			}}
		>
			{auth.user ? auth.user.name : "Login"}
		</Button>
	);
};
