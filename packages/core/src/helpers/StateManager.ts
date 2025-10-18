import type { State } from "../Alepha.ts";
import type { AlsProvider } from "../providers/AlsProvider.ts";
import type { EventManager } from "./EventManager.ts";

export class StateManager<S extends Record<string, any> = State> {
	protected store: Partial<S> = {};
	protected readonly events?: EventManager;
	protected readonly als?: AlsProvider;

	constructor(events?: EventManager, als?: AlsProvider) {
		this.events = events;
		this.als = als;
	}

	/**
	 * Get a value from the state with proper typing
	 */
	public get<Key extends keyof S>(key: Key): S[Key] | undefined {
		if (this.als?.exists()) {
			return this.als.get<S[Key]>(key as string) ?? this.store[key];
		}
		return this.store[key];
	}

	/**
	 * Set a value in the state
	 */
	public set<Key extends keyof S>(key: Key, value: S[Key] | undefined): this {
		const prevValue = this.get(key);
		if (prevValue === value) {
			return this;
		}

		if (this.als?.exists()) {
			this.als.set(key as string, value);
		} else {
			this.store[key] = value;
		}

		this.events
			?.emit(
				"state:mutate",
				{ key: key as keyof State, value, prevValue },
				{ catch: true },
			)
			.catch(() => null);

		return this;
	}

	/**
	 * Check if a key exists in the state
	 */
	public has<Key extends keyof S>(key: Key): boolean {
		return key in this.store;
	}

	/**
	 * Delete a key from the state (set to undefined)
	 */
	public del<Key extends keyof S>(key: Key): this {
		return this.set(key, undefined);
	}

	/**
	 * Clear all state
	 */
	public clear(): this {
		this.store = {};
		return this;
	}

	/**
	 * Get all keys that exist in the state
	 */
	public keys(): (keyof S)[] {
		return Object.keys(this.store) as (keyof S)[];
	}
}
