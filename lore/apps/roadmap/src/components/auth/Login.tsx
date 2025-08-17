import { t } from "@alepha/core";
import { useInject, useRouter } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { Flex, Text } from "@alepha/react-flex";
import { useForm } from "@alepha/react-form";
import { HttpError } from "@alepha/server";
import { Toaster } from "../../services/Toaster.ts";
import Action from "../shared/Action.tsx";
import Control from "../shared/Control.tsx";

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
		<Flex fill center layout bg>
			<Flex col gap1 style={{ width: "300px" }}>
				<Flex col pad3 gap3 card rounded shadow={2} bordered>
					<Flex form={{ onSubmit: form.onSubmit }} col fill gap1>
						<Control
							inputField={form.input.username}
							inputGroupProps={{
								autoComplete: "username",
							}}
						/>
						<Control
							inputField={form.input.password}
							inputGroupProps={{
								autoComplete: "current-password",
								type: "password",
							}}
						/>
						<Action type={"submit"} intent={"success"}>
							Sign in
						</Action>
					</Flex>
					<Flex center gap3>
						<Flex fill bordered />
						<Text small>or</Text>
						<Flex fill bordered />
					</Flex>
					<Flex col gap1>
						<Action
							style={{
								backgroundColor: "#24292e",
							}}
							intent={"primary"}
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
	);
};

export default Login;
