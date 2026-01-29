export interface MainCssOptions {
  ui?: boolean;
}

export const mainCss = (options: MainCssOptions = {}) => {
  if (options.ui) {
    return `@import "@alepha/ui/styles";`;
  }

  return `
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body {
  height: 100%;
}

body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

#root {
  height: 100%;
}
`.trim();
};
