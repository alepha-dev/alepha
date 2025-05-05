import { $cursor } from "./$cursor.ts";

export const $logger = (name?: string) => {
	const { context, definition } = $cursor();

	return context.log.child({
		caller: name ?? definition?.name,
	});
};
