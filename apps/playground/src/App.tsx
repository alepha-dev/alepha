import { useClient } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { useHead } from "@alepha/react-head";
import { useState } from "react";
import type { Api } from "./Api.ts";

const App = () => {
	const [, setHead] = useHead({
		title: "1",
	});

	const [response, setResponse] = useState("");
	const api = useClient<Api>();
	const auth = useAuth<Api>();

	return (
		<div>
			Hello
			<button
				onClick={() => {
					setHead((t) => ({
						title: `${Number(t?.title) + 1}`,
					}));
					api.ping();
				}}
			>
				Change Title
			</button>
			{auth.user ? (
				<button
					onClick={async () => {
						await auth.logout();
					}}
				>
					logout ({auth.user.name})
				</button>
			) : (
				<button
					onClick={async () => {
						await auth.login("google");
					}}
				>
					login
				</button>
			)}
			<button
				disabled={!api.ping.can()}
				onClick={async () => {
					setResponse("");
					const r = await api.ping();
					setResponse(r.pong ? "pong" : "no pong");
				}}
			>
				ping - {response}
			</button>
		</div>
	);
};

export default App;
