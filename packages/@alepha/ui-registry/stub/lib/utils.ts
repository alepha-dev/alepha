export const cn = (...args: Array<string | undefined | false>) =>
  args.filter(Boolean).join(" ");
