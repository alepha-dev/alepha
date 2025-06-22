# alepha/file

```ts
import { file } from "alepha/file";

const image = file("https://example.com/image.png");
const text = file("file://home/dev/text.txt");
const buffer = file("hello world", { name: "message.txt", type: "text/plain" });
```
