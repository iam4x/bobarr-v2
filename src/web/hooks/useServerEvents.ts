import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

const eventQueryKeys: Record<string, string[]> = {
  "download.changed": ["downloads"],
  "job.changed": ["jobs"],
  "library.changed": ["library"],
  "activity.created": ["activity"],
  "service.changed": ["system"],
};

export function useServerEvents(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    const source = new EventSource("/api/v1/events", { withCredentials: true });

    const refresh = (event: MessageEvent<string>) => {
      let type = "activity.created";
      try {
        const payload = JSON.parse(event.data) as { type?: string };
        type = payload.type ?? type;
      } catch {
        // Unknown messages still refresh the activity snapshot.
      }
      if (type === "snapshot.invalidated") {
        void queryClient.invalidateQueries();
        return;
      }
      const rootKey = eventQueryKeys[type] ?? ["activity"];
      void queryClient.invalidateQueries({ queryKey: rootKey });
    };

    for (const type of [
      "snapshot.invalidated",
      "download.changed",
      "job.changed",
      "library.changed",
      "service.changed",
      "activity.created",
    ]) {
      source.addEventListener(type, refresh as EventListener);
    }

    return () => source.close();
  }, [enabled, queryClient]);
}
