import { t } from "@alepha/core";
import { useRouter } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { Flex } from "@alepha/react-flex";
import { useForm } from "@alepha/react-form";
import { InputGroup } from "@blueprintjs/core";
import Action from "../shared/Action.tsx";

const Login = () => {
	const auth = useAuth();
	const router = useRouter();

	const form = useForm({
		schema: t.object({
			username: t.string(),
			password: t.string(),
		}),
		handler: async (data) => {
			await auth.login("usernamePassword", data);
			await router.go(router.query.r || "/");
		},
	});

	return (
		<Flex fill center layout>
			<Flex col gap1 style={{ width: "300px" }}>
				<Flex col pad2 gap2 card rounded shadow={2} bordered>
					<form onSubmit={form.onSubmit}>
						<Flex col fill gap2>
							<InputGroup
								{...form.input.username.props}
								leftIcon={"person"}
								placeholder={"Email"}
							/>
							<InputGroup
								{...form.input.password.props}
								leftIcon={"key"}
								placeholder={"Password"}
								type={"password"}
							/>
							<Action type={"submit"}>Sign in</Action>
						</Flex>
					</form>
					<Flex center>or</Flex>
					<Action
						type={"button"}
						onClick={() => {
							auth.login("github", {
								redirect: router.query.r || "/",
							});
						}}
					>
						Sign in with GitHub
					</Action>
					<Action
						type={"button"}
						onClick={() => {
							auth.login("google", {
								redirect: router.query.r || "/",
							});
						}}
					>
						Sign in with Google
					</Action>
				</Flex>
				<Action variant={"minimal"} href={"/"}>
					Cancel
				</Action>
			</Flex>
		</Flex>
	);
};

export default Login;
