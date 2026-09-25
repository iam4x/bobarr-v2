import type { Messages } from "./en";

import { en } from "./en";

export function statusLabel(state: string, messages: Messages = en): string {
  const labels: Record<string, string> = messages.status;
  return labels[state] ?? `${state.slice(0, 1).toUpperCase()}${state.slice(1)}`;
}
