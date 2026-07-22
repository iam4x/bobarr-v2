import { AppError } from "./errors";

export function parseJsonObject(
  value: string,
  label: string,
): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    throw new AppError({
      code: "internal_error",
      message: `Stored ${label} is invalid`,
      status: 500,
      cause: error,
    });
  }

  throw new AppError({
    code: "internal_error",
    message: `Stored ${label} is invalid`,
    status: 500,
  });
}

export function toIsoDate(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toISOString();
}
