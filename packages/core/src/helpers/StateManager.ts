import type { State } from "../Alepha.ts";
import type { EventManager } from "./EventManager.ts";

export class StateManager<S extends Record<string, any> = State> {
	private store: Partial<S> = {};
	protected events?: EventManager;

	constructor(events?: EventManager) {
		this.events = events;
	}

	/**
	 * Get a value from the state with proper typing
	 */
	get<Key extends keyof S>(key: Key): S[Key] | undefined {
		return this.store[key];
	}

	/**
	 * Set a value in the state
	 */
	set<Key extends keyof S>(key: Key, value: S[Key] | undefined): this {
		const prevValue = this.store[key];
		if (prevValue === value) {
			return this;
		}

		this.store[key] = value;

		this.events
			?.emit(
				"state:mutate",
				{ key: key as string, value, prevValue },
				{ catch: true },
			)
			.catch(() => null);

		return this;
	}

	/**
	 * Check if a key exists in the state
	 */
	has<Key extends keyof S>(key: Key): boolean {
		return key in this.store;
	}

	/**
	 * Delete a key from the state (set to undefined)
	 */
	del<Key extends keyof S>(key: Key): this {
		return this.set(key, undefined);
	}

	/**
	 * Clear all state
	 */
	clear(): this {
		this.store = {};
		return this;
	}

	/**
	 * Get all keys that exist in the state
	 */
	keys(): (keyof S)[] {
		return Object.keys(this.store) as (keyof S)[];
	}
}
