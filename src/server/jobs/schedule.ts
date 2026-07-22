const MINUTE_MS = 60_000;
const MAX_SEARCH_MINUTES = 366 * 24 * 60 * 5;

interface CronField {
  values: ReadonlySet<number>;
  unrestricted: boolean;
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

/** Return the first UTC minute strictly after `after` matching a five-field cron. */
export function nextCronOccurrence(expression: string, after: Date): Date {
  if (Number.isNaN(after.getTime()))
    throw new TypeError("Invalid schedule date");
  const cron = parseCron(expression);
  let timestamp =
    Math.floor(after.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  for (let offset = 0; offset < MAX_SEARCH_MINUTES; offset += 1) {
    const candidate = new Date(timestamp);
    if (matches(cron, candidate)) return candidate;
    timestamp += MINUTE_MS;
  }
  throw new RangeError("Schedule has no occurrence within five years");
}

export function validateCronExpression(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new TypeError("Cron expression must contain five fields");
  }
  return {
    minute: parseField(fields[0]!, 0, 59),
    hour: parseField(fields[1]!, 0, 23),
    dayOfMonth: parseField(fields[2]!, 1, 31),
    month: parseField(fields[3]!, 1, 12),
    dayOfWeek: parseField(fields[4]!, 0, 7, true),
  };
}

function parseField(
  field: string,
  minimum: number,
  maximum: number,
  normalizeSunday = false,
): CronField {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    if (!rangePart || part.split("/").length > 2) {
      throw new TypeError(`Invalid cron field: ${field}`);
    }
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isSafeInteger(step) || step <= 0) {
      throw new TypeError(`Invalid cron step: ${part}`);
    }
    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = minimum;
      end = maximum;
    } else if (rangePart.includes("-")) {
      const bounds = rangePart.split("-");
      if (bounds.length !== 2)
        throw new TypeError(`Invalid cron range: ${part}`);
      start = Number(bounds[0]);
      end = Number(bounds[1]);
    } else {
      start = Number(rangePart);
      end = start;
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < minimum ||
      end > maximum ||
      start > end
    ) {
      throw new RangeError(`Cron value is outside ${minimum}-${maximum}`);
    }
    for (let value = start; value <= end; value += step) {
      values.add(normalizeSunday && value === 7 ? 0 : value);
    }
  }
  return { values, unrestricted: field === "*" };
}

function matches(cron: ParsedCron, date: Date): boolean {
  if (
    !cron.minute.values.has(date.getUTCMinutes()) ||
    !cron.hour.values.has(date.getUTCHours()) ||
    !cron.month.values.has(date.getUTCMonth() + 1)
  ) {
    return false;
  }
  const dayOfMonth = cron.dayOfMonth.values.has(date.getUTCDate());
  const dayOfWeek = cron.dayOfWeek.values.has(date.getUTCDay());
  if (!cron.dayOfMonth.unrestricted && !cron.dayOfWeek.unrestricted) {
    return dayOfMonth || dayOfWeek;
  }
  return dayOfMonth && dayOfWeek;
}
