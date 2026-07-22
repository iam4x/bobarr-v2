const SENSITIVE_KEY =
  /(?:authorization|cookie|credential|password|passkey|secret|token|api[-_]?key|magnet|tracker|download[-_]?url)/i;
const MAGNET_VALUE = /magnet:\?[^\s"'<>]*/gi;
const SENSITIVE_QUERY_VALUE =
  /([?&](?:api[-_]?key|auth|authorization|credential|key|passkey|password|secret|token)=)[^&#\s"'<>]*/gi;
const URL_CREDENTIALS = /(https?:\/\/[^/\s:@]+:)[^@\s/]+@/gi;
const MAX_DEPTH = 8;

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface JsonLoggerOptions {
  minimumLevel?: LogLevel;
  service?: string;
  version?: string;
  write?: (line: string) => void;
}

const levels: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(options: JsonLoggerOptions = {}): Logger {
  return createChildLogger(options, {
    service: options.service ?? "bobarr",
    ...(options.version === undefined ? {} : { version: options.version }),
  });
}

export function redactLogValue(value: unknown): unknown {
  return redact(value, 0, new WeakSet<object>());
}

function createChildLogger(
  options: JsonLoggerOptions,
  bindings: LogFields,
): Logger {
  const minimumLevel = levels[options.minimumLevel ?? "info"];
  const write =
    options.write ?? ((line: string) => void Bun.stdout.write(`${line}\n`));

  const log = (
    level: LogLevel,
    event: string,
    fields: LogFields = {},
  ): void => {
    if (levels[level] < minimumLevel) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...(redactLogValue(bindings) as Record<string, unknown>),
      ...(redactLogValue(fields) as Record<string, unknown>),
    };
    write(JSON.stringify(entry));
  };

  return {
    debug: (event, fields) => log("debug", event, fields),
    info: (event, fields) => log("info", event, fields),
    warn: (event, fields) => log("warn", event, fields),
    error: (event, fields) => log("error", event, fields),
    child: (fields) => createChildLogger(options, { ...bindings, ...fields }),
  };
}

function redact(
  value: unknown,
  depth: number,
  visited: WeakSet<object>,
): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (typeof value === "string") {
    return redactText(value);
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
    };
  }
  if (typeof value !== "object") return String(value);
  if (visited.has(value)) return "[circular]";
  visited.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1, visited));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key)
      ? "[redacted]"
      : redact(item, depth + 1, visited);
  }
  return result;
}

export function redactText(value: string): string {
  return value
    .replace(MAGNET_VALUE, "[redacted magnet]")
    .replace(SENSITIVE_QUERY_VALUE, "$1[redacted]")
    .replace(URL_CREDENTIALS, "$1[redacted]@");
}
