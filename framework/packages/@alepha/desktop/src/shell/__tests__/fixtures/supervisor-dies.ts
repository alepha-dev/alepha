declare const self: any;

// A supervisor that answers `started`, then dies with the window open.
self.addEventListener("message", (event: { data: { type: string } }) => {
  if (event.data.type === "start") {
    self.postMessage({
      type: "started",
      result: { ok: true, origin: "http://127.0.0.1:1" },
    });
    setTimeout(() => {
      throw new Error("injected supervisor crash");
    }, 10);
  }
});
