import { __descriptor, KIND, NotImplementedError, OPTIONS } from "@alepha/core";

const KEY = "SEQUENCE";

export const $sequence = (
	options: SequenceDescriptorOptions = {},
): SequenceDescriptor => {
	__descriptor(KEY);

	const $: SequenceDescriptor = async () => {
		throw new NotImplementedError(KEY);
	};

	$[KIND] = KEY;
	$[OPTIONS] = options;
	$.next = async () => {
		throw new NotImplementedError(KEY);
	};
	$.current = async () => {
		throw new NotImplementedError(KEY);
	};

	return $;
};

$sequence[KIND] = KEY;

// ---------------------------------------------------------------------------------------------------------------------

export interface SequenceDescriptorOptions {
	name?: string;
	start?: number;
	increment?: number;
	min?: number;
	max?: number;
	cycle?: boolean;
}

export interface SequenceDescriptor {
	[KIND]: typeof KEY;
	[OPTIONS]: SequenceDescriptorOptions;
	(): Promise<number>;
	next(): Promise<number>;
	current(): Promise<number>;
}
