export const indexHtml = (
  browserEntry: string,
) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>App</title>
</head>
<body>
<div id="root"></div>
<script type="module" src="${browserEntry}"></script>
</body>
</html>
`.trim();
