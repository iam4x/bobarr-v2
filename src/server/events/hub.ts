export type BobarrEventType =
  | "snapshot.invalidated"
  | "download.changed"
  | "job.changed"
  | "library.changed"
  | "service.changed"
  | "activity.created";

export interface BobarrEvent<T = unknown> {
  id: string;
  type: BobarrEventType;
  occurredAt: string;
  data: T;
}

export interface EventHub {
  publish<T>(type: BobarrEventType, data: T): BobarrEvent<T>;
  stream(signal?: AbortSignal): ReadableStream<Uint8Array>;
  close(): void;
  readonly subscribers: number;
}

export function createEventHub(heartbeatMs = 15_000): EventHub {
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 1_000) {
    throw new TypeError("SSE heartbeat must be at least one second");
  }
  const encoder = new TextEncoder();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const heartbeat = setInterval(() => {
    const frame = encoder.encode(`: heartbeat ${Date.now()}\n\n`);
    for (const client of clients) enqueue(client, frame, clients);
  }, heartbeatMs);
  heartbeat.unref?.();

  const publish = <T>(type: BobarrEventType, data: T): BobarrEvent<T> => {
    const event: BobarrEvent<T> = {
      id: crypto.randomUUID(),
      type,
      occurredAt: new Date().toISOString(),
      data,
    };
    const frame = encoder.encode(formatEvent(event));
    for (const client of clients) enqueue(client, frame, clients);
    return event;
  };

  return {
    publish,

    stream(signal) {
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      const remove = (): void => {
        if (controller !== undefined) clients.delete(controller);
      };
      return new ReadableStream<Uint8Array>({
        start(nextController) {
          controller = nextController;
          clients.add(nextController);
          nextController.enqueue(
            encoder.encode(
              formatEvent({
                id: crypto.randomUUID(),
                type: "snapshot.invalidated",
                occurredAt: new Date().toISOString(),
                data: { resources: ["downloads", "jobs", "library", "system"] },
              }),
            ),
          );
          if (signal?.aborted === true) {
            remove();
            nextController.close();
          } else {
            signal?.addEventListener(
              "abort",
              () => {
                remove();
                try {
                  nextController.close();
                } catch {
                  // The network stack may already have closed the controller.
                }
              },
              { once: true },
            );
          }
        },
        cancel: remove,
      });
    },

    close() {
      clearInterval(heartbeat);
      for (const client of clients) {
        try {
          client.close();
        } catch {
          // Ignore controllers already closed by their clients.
        }
      }
      clients.clear();
    },

    get subscribers() {
      return clients.size;
    },
  };
}

function formatEvent(event: BobarrEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function enqueue(
  controller: ReadableStreamDefaultController<Uint8Array>,
  frame: Uint8Array,
  clients: Set<ReadableStreamDefaultController<Uint8Array>>,
): void {
  try {
    controller.enqueue(frame);
  } catch {
    clients.delete(controller);
  }
}
