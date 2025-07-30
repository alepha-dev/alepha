import type { State } from "@alepha/core";
import { useEffect, useState } from "react";
import { useAlepha } from "./useAlepha.ts";

/**
 * Hook to access and mutate the Alepha state.
 */
export const useStore = <Key extends keyof State>(
	key: Key,
): [State[Key], (value: State[Key]) => void] => {
	const alepha = useAlepha();
	const [state, setState] = useState(alepha.state(key));

	useEffect(() => {
		if (!alepha.isBrowser()) {
			return;
		}

		return alepha.on("state:mutate", (ev) => {
			if (ev.key === key) {
				setState(ev.value);
			}
		});
	}, []);

	if (!alepha.isBrowser()) {
		const value = alepha.context.get(key) as State[Key];
		if (value !== null) {
			return [value, (_: State[Key]) => {}] as const;
		}
	}

	return [
		state,
		(value: State[Key]) => {
			alepha.state(key, value);
		},
	] as const;
};
