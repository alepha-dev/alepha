import { t } from "@alepha/core";
import { useInject, useRouter } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { Flex, Text } from "@alepha/react-flex";
import { useForm } from "@alepha/react-form";
import { HttpError } from "@alepha/server";
import { Envelope, Lock } from "@blueprintjs/icons";
import { Toaster } from "../../services/Toaster.ts";
import Action from "../shared/Action.tsx";
import Control from "../shared/Control.tsx";
import StupidLogo from "../shared/StupidLogo.tsx";

const Login = () => {
	const auth = useAuth();
	const router = useRouter();
	const toaster = useInject(Toaster);

	const form = useForm({
		schema: t.object({
			username: t.string(),
			password: t.string(),
		}),
		handler: async (data) => {
			await auth.login("usernamePassword", data);
			await router.go(router.query.r || "/");
		},
		onError: (error) => {
			if (HttpError.is(error, 401)) {
				toaster.show("Invalid credentials.", "danger");
			} else {
				toaster.show((error as Error).message, "danger");
			}
		},
	});

	return (
		<Flex col layout>
			<Flex fill gap1 center col>
				<Flex col gap1 pad3 rounded style={{ width: 360 }}>
					<Flex center pad2>
						<Flex center gap1>
							<StupidLogo />
							<Text large={2}>Roadmap</Text>
						</Flex>
					</Flex>
					<Flex col pad3 gap3 card rounded shadow={2} bordered>
						<Flex form={{ onSubmit: form.onSubmit }} col fill gap2>
							<Control
								formGroupProps={{}}
								inputField={form.input.username}
								inputGroupProps={{
									leftElement: <Envelope />,
									autoComplete: "username",
								}}
							/>
							<Control
								inputField={form.input.password}
								inputGroupProps={{
									leftElement: <Lock />,
									autoComplete: "current-password",
									type: "password",
								}}
							/>
							<Action type={"submit"} intent={"success"}>
								Sign in
							</Action>
						</Flex>
						<Flex center gap3>
							<Flex fill bordered style={{ height: 1 }} />
							<Text small>OR</Text>
							<Flex fill bordered style={{ height: 1 }} />
						</Flex>
						<Flex col gap1>
							<Action
								className={"github-button"}
								icon={
									<img
										alt={"github"}
										src={"/logo-github.svg"}
										height={24}
										width={24}
									/>
								}
								type={"button"}
								onClick={() => {
									auth.login("github", {
										redirect: router.query.r || "/",
									});
								}}
							>
								Continue with GitHub
							</Action>
							<Action
								variant={"outlined"}
								icon={
									<img
										alt={"google"}
										src={"/logo-google.svg"}
										height={24}
										width={24}
									/>
								}
								type={"button"}
								onClick={() => {
									auth.login("google", {
										redirect: router.query.r || "/",
									});
								}}
							>
								Continue with Google
							</Action>
						</Flex>
					</Flex>
					<Action variant={"minimal"} href={"/"}>
						Cancel
					</Action>
				</Flex>
			</Flex>
		</Flex>
	);
};

export default Login;
