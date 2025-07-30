import type { Alepha } from "@alepha/core";
import { useContext } from "react";
import { AlephaContext } from "../contexts/AlephaContext.ts";

export const useAlepha = (): Alepha => {
	const alepha = useContext(AlephaContext);
	if (!alepha) {
		throw new Error("useAlepha must be used within an AlephaContext.Provider");
	}

	return alepha;
};
