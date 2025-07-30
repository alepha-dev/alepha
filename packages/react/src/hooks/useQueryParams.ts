import type { Alepha, Static, TObject } from "@alepha/core";
import { useEffect, useState } from "react";
import { useAlepha } from "./useAlepha.ts";
import { useRouter } from "./useRouter.ts";

export interface UseQueryParamsHookOptions {
	format?: "base64" | "querystring";
	key?: string;
	push?: boolean;
}

export const useQueryParams = <T extends TObject>(
	schema: T,
	options: UseQueryParamsHookOptions = {},
): [Static<T>, (data: Static<T>) => void] => {
	const alepha = useAlepha();

	const key = options.key ?? "q";
	const router = useRouter();
	const querystring = router.query[key];

	const [queryParams, setQueryParams] = useState(
		decode(alepha, schema, router.query[key]),
	);

	useEffect(() => {
		setQueryParams(decode(alepha, schema, querystring));
	}, [querystring]);

	return [
		queryParams,
		(queryParams: Static<T>) => {
			setQueryParams(queryParams);
			router.setQueryParams((data) => {
				return { ...data, [key]: encode(alepha, schema, queryParams) };
			});
		},
	];
};

// ---------------------------------------------------------------------------------------------------------------------

const encode = (alepha: Alepha, schema: TObject, data: any) => {
	return btoa(JSON.stringify(alepha.parse(schema, data)));
};

const decode = (alepha: Alepha, schema: TObject, data: any) => {
	try {
		return alepha.parse(schema, JSON.parse(atob(decodeURIComponent(data))));
	} catch (_error) {
		return {};
	}
};
