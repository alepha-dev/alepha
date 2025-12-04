import { $command } from "alepha/command";

export default () => {
  return {
    deploy: $command({
      handler: async ({ run }) => {
        await run("yarn alepha build");
        await run("cd dist && vercel deploy --prod");
      },
    }),
  };
};
