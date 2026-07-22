import { describe, expect, test } from "bun:test";

import { createEventHub } from "./hub";

describe("event hub", () => {
  test("invalidates REST snapshots when a client connects", async () => {
    const hub = createEventHub(60_000);
    const reader = hub.stream().getReader();

    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain(
      "event: snapshot.invalidated",
    );

    await reader.cancel();
    expect(hub.subscribers).toBe(0);
    hub.close();
  });

  test("publishes typed event frames", async () => {
    const hub = createEventHub(60_000);
    const reader = hub.stream().getReader();
    await reader.read();

    hub.publish("download.changed", { id: "download-1" });
    const next = await reader.read();
    const frame = new TextDecoder().decode(next.value);
    expect(frame).toContain("event: download.changed");
    expect(frame).toContain('"id":"download-1"');

    await reader.cancel();
    hub.close();
  });
});
