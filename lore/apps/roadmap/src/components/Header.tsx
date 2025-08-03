import { type TypeBoxError, t } from "@alepha/core";
import { useClient, useInject } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { Flex, Text } from "@alepha/react-flex";
import { useForm } from "@alepha/react-form";
import { useI18n } from "@alepha/react-i18n";
import {
	Button,
	Drawer,
	FormGroup,
	HTMLSelect,
	Icon,
	Menu,
	MenuItem,
	Popover,
	TextArea,
} from "@blueprintjs/core";
import { useState } from "react";
import type TaskApi from "../api/TaskApi.ts";
import type { I18n } from "../services/I18n.ts";
import { Theme } from "../services/Theme.ts";
import Control from "./ui/Control.tsx";

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
					<Ping />
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

const Ping = () => {
	const taskApi = useClient<TaskApi>();
	return (
		<Button
			disabled={!taskApi.ping.can()}
			text={"Ping"}
			onClick={async () => {
				await taskApi.ping({});
			}}
		/>
	);
};

const AddTask = () => {
	const [showDialog, setShowDialog] = useState(false);
	const { tr } = useI18n<I18n, "en">();
	const [error, setError] = useState<TypeBoxError | undefined>();

	const form = useForm({
		id: "add-task",
		schema: t.object({
			package: t.string(),
			name: t.string({
				title: tr("roadmap.header.addTask.name"),
				minLength: 20,
			}),
			description: t.string(),
		}),
		handler: () => {
			setShowDialog(false);
		},
		onError: (err) => {
			setError(err);
			document
				.getElementById(`add-task${err.value.path.replaceAll("/", "-")}`)
				?.focus();
		},
		onChange: (key) => {
			if (error?.value.path === key) {
				setError(undefined);
			}
		},
	});

	return (
		<Flex>
			<Button
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
					<Flex card fill col gap1 pad4 rounded bordered>
						<Flex fill>
							<form style={{ maxWidth: "512px" }} onSubmit={form.onSubmit}>
								<Flex gap1>
									<FormGroup
										style={{ width: 256 }}
										label="Package"
										labelFor="text-input2"
									>
										<HTMLSelect
											id="text-input2"
											fill
											autoFocus
											{...form.input.package.props}
										>
											<option value=""></option>
											<option value="task1">React Head</option>
											<option value="task2">React Form</option>
											<option value="task3">Queue</option>
										</HTMLSelect>
									</FormGroup>
									<Control
										inputField={form.input.name}
										error={error}
										inputGroupProps={{
											leftElement: <Icon icon={"tag"} />,
										}}
									/>
								</Flex>

								<FormGroup label="Description" labelFor="text-input3">
									<TextArea
										{...form.input.description.props}
										id={"text-input3"}
										fill
										rows={10}
									/>
								</FormGroup>

								<Button
									type="submit"
									variant={"outlined"}
									icon={"cube-add"}
									size={"large"}
									intent={"success"}
								>
									Create Task
								</Button>
							</form>
						</Flex>
						<Flex>
							<Flex fill></Flex>
							<Flex></Flex>
						</Flex>
					</Flex>
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
