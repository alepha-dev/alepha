import { useClient } from "@alepha/react";
import { useState } from "react";
import type Api from "../controllers/Api.ts";
import type { IncResponse } from "../controllers/Api.ts";

const Test = (props: { inc: IncResponse }) => {
	const cli = useClient<Api>();
	const [state, setState] = useState<IncResponse>(props.inc);

	return (
		<div>
			<button
				onClick={async () => {
					await cli.hi();
				}}
			>
				hi
			</button>
			<button
				onClick={async () => {
					setState(await cli.inc());
				}}
			>
				inc
			</button>
			{state && (
				<div>
					<div>Type: {state.type}</div>
					<div>Count: {state.count}</div>
					<div>Session: {state.v}</div>
				</div>
			)}
		</div>
	);
};

export default Test;
