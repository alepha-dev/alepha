export const indexHtml = (
  browserEntry: string = "/src/main.tsx",
) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>App</title>
</head>
<body>
<script type="module" src="${browserEntry}"></script>
</body>
</html>
`.trim()
