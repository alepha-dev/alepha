import { __descriptor, KIND, NotImplementedError } from "@alepha/core";

const KEY = "SEQUENCE";

export interface SequenceDescriptorOptions {
	/**
	 *
	 */
	name?: string;

	/**
	 *
	 */
	start?: number;

	/**
	 *
	 */
	increment?: number;

	/**
	 *
	 */
	min?: number;

	/**
	 *
	 */
	max?: number;

	/**
	 *
	 */
	cycle?: boolean;
}

export interface SequenceDescriptor {
	[KIND]: typeof KEY;
	options: SequenceDescriptorOptions;

	/**
	 *
	 */
	(): Promise<number>;

	/**
	 *
	 */
	next(): Promise<number>;

	/**
	 *
	 */
	current(): Promise<number>;
}

/**
 *
 * @param options
 */
export const $sequence = (
	options: SequenceDescriptorOptions = {},
): SequenceDescriptor => {
	__descriptor(KEY);

	const $: SequenceDescriptor = async () => {
		throw new NotImplementedError(KEY);
	};

	$[KIND] = KEY;
	$.options = options;
	$.next = async () => {
		throw new NotImplementedError(KEY);
	};
	$.current = async () => {
		throw new NotImplementedError(KEY);
	};

	return $;
};

$sequence[KIND] = KEY;
