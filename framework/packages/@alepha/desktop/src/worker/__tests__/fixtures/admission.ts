/**
 * Plays the window: exchange the launch capability for the session cookie,
 * and answer a fetch that sends it.
 */
export const login = async (origin: string, capability: string) => {
  const response = await fetch(
    `${origin}/__alepha_desktop/bootstrap?capability=${capability}`,
    {
      redirect: "manual",
    },
  );
  if (response.status !== 303) {
    throw new Error(`bootstrap answered ${response.status}`);
  }
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  return (path: string, init: RequestInit = {}) =>
    fetch(`${origin}${path}`, {
      ...init,
      headers: { cookie, ...(init.headers as Record<string, string>) },
    });
};
