import { describe, expect, test } from "bun:test";

import { createLogger, redactLogValue } from "./logger";

describe("structured logger", () => {
  test("redacts nested credentials and complete magnet values", () => {
    expect(
      redactLogValue({
        username: "bobarr",
        password: "do-not-print",
        nested: {
          jackettApiKey: "tracker-secret",
          source: "magnet:?xt=urn:btih:abc&tr=https://passkey.example",
        },
      }),
    ).toEqual({
      username: "bobarr",
      password: "[redacted]",
      nested: {
        jackettApiKey: "[redacted]",
        source: "[redacted magnet]",
      },
    });
  });

  test("redacts magnets and URL credentials embedded inside errors", () => {
    const redacted = redactLogValue(
      new Error(
        "Invalid URL: magnet:?xt=urn:btih:abc&tr=https://tracker.test/announce?passkey=never-log-me",
      ),
    );
    expect(redacted).toEqual({
      name: "Error",
      message: "Invalid URL: [redacted magnet]",
    });
    expect(
      redactLogValue(
        "Connector failed at https://user:password@example.test/rpc?token=also-secret",
      ),
    ).toBe(
      "Connector failed at https://user:[redacted]@example.test/rpc?token=[redacted]",
    );
  });

  test("emits one JSON record with inherited correlation fields", () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (line) => lines.push(line) }).child({
      requestId: "request-1",
    });

    logger.info("request.completed", { status: 200 });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      level: "info",
      event: "request.completed",
      requestId: "request-1",
      status: 200,
    });
  });
});
