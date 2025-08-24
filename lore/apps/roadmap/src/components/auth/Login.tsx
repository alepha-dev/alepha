import { TypeBoxError, t } from "@alepha/core";
import { useRouter } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { useForm } from "@alepha/react-form";
import { HttpError } from "@alepha/server";
import { Card, Center, Flex, Group, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconLock, IconMail } from "@tabler/icons-react";
import StupidLogo from "../shared/StupidLogo.tsx";
import Action from "../ui/Action.tsx";
import Control from "../ui/Control.tsx";

const Login = () => {
	const auth = useAuth();
	const router = useRouter();

	const form = useForm({
		schema: t.object({
			username: t.string({
				minLength: 6,
			}),
			password: t.string({
				minLength: 6,
			}),
		}),
		handler: async (data) => {
			await auth.login("usernamePassword", data);
			await router.go(router.query.r || "/");
		},
		onError: (error) => {
			if (error instanceof TypeBoxError) {
				return; // handled by the form
			}

			notifications.show({
				position: "top-center",
				withBorder: true,
				withCloseButton: true,
				title: "Invalid credentials",
				message:
					error instanceof HttpError && error.status === 401
						? "The username or password is incorrect."
						: "An unexpected error occurred. Please try again later.",
				color: "red",
			});
		},
	});

	return (
		<Center flex={1}>
			<Stack gap={"sm"} w={360}>
				<Center p={"sm"}>
					<Group gap={"xs"}>
						<StupidLogo />
						<Text size="xl">Roadmap</Text>
					</Group>
				</Center>
				<Card withBorder p={"lg"} bg={"var(--card-bg-color)"}>
					<Stack gap={"md"}>
						<form onSubmit={form.onSubmit} noValidate>
							<Stack flex={1} gap={"md"}>
								<Control
									input={form.input.username}
									icon={<IconMail />}
									text={{
										autoComplete: "username",
									}}
								/>
								<Control
									input={form.input.password}
									icon={<IconLock />}
									password={{
										autoComplete: "current-password",
									}}
								/>
								<Action form={form}>Sign in</Action>
							</Stack>
						</form>
						<Group align="center" justify="center" gap={"md"}>
							<Flex flex={1} h={"1px"} bg={"var(--text-muted)"} />
							<Text size="xs">OR</Text>
							<Flex flex={1} h={"1px"} bg={"var(--text-muted)"} />
						</Group>
						<Stack gap={"sm"}>
							<Action
								className={"github-button"}
								leftSection={
									<img
										alt={"github"}
										src={"/logo-github.svg"}
										height={24}
										width={24}
									/>
								}
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
								leftSection={
									<img
										alt={"google"}
										src={"/logo-google.svg"}
										height={24}
										width={24}
									/>
								}
								onClick={() =>
									auth.login("google", {
										redirect: router.query.r || "/",
									})
								}
							>
								Continue with Google
							</Action>
						</Stack>
					</Stack>
				</Card>
				<Action variant={"subtle"} href={"/"}>
					Cancel
				</Action>
			</Stack>
		</Center>
	);
};

export default Login;
