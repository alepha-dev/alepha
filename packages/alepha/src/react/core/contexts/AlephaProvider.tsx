import { Alepha } from "alepha";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AlephaContext } from "./AlephaContext.ts";

export interface AlephaProviderProps {
  children: ReactNode;
  onError: (error: Error) => ReactNode;
  onLoading: () => ReactNode;
}

/**
 * AlephaProvider component to initialize and provide Alepha instance to the app.
 *
 * This isn't recommended for apps using `alepha/react/router`, as Router will handle this for you.
 */
export const AlephaProvider = (props: AlephaProviderProps) => {
  const alepha = useMemo(() => Alepha.create(), []);

  const [started, setStarted] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  useEffect(() => {
    alepha
      .start()
      .then(() => setStarted(true))
      .catch((err) => setError(err));
  }, [alepha]);

  if (error) {
    return props.onError(error);
  }

  if (!started) {
    return props.onLoading();
  }

  return (
    <AlephaContext.Provider value={alepha}>
      {props.children}
    </AlephaContext.Provider>
  );
};
