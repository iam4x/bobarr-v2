import type { CalendarItem } from "../types";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { useMemo } from "react";

import { api } from "../api/client";
import { collectionItems } from "../api/normalize";
import { Page } from "../components/Page";
import { Badge, EmptyState, ErrorState, InlineSpinner } from "../components/ui";
import { statusLabel } from "../i18n/status";
import { useUi } from "../i18n/ui";
import { formatDate, imageUrl, initials } from "../lib/format";

/** The viewer's calendar day, e.g. still "today" at 00:30 in Paris. */
export function localIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function groupCalendar(items: CalendarItem[]): Array<[string, CalendarItem[]]> {
  const groups = new Map<string, CalendarItem[]>();
  for (const item of [...items].sort((a, b) =>
    a.airDate.localeCompare(b.airDate),
  )) {
    const day = item.airDate.slice(0, 10);
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }
  return [...groups.entries()];
}

function calendarTone(
  state: CalendarItem["acquisitionState"],
): "success" | "danger" | "neutral" {
  if (state === "available") return "success";
  if (state === "missing") return "danger";
  return "neutral";
}

export function CalendarPage() {
  const { messages, locale } = useUi();
  const range = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setDate(end.getDate() + 35);
    end.setHours(23, 59, 59, 999);
    return { from: start.toISOString(), to: end.toISOString() };
  }, []);
  const calendarQuery = useQuery({
    queryKey: ["calendar", range.from, range.to],
    queryFn: ({ signal }) => api.get("calendar", { query: range, signal }),
  });
  const groups = groupCalendar(collectionItems(calendarQuery.data));
  const today = localIsoDate(new Date());

  return (
    <Page
      eyebrow={messages.calendar.eyebrow}
      title={messages.calendar.title}
      description={messages.calendar.description}
      wide
    >
      {calendarQuery.isLoading ? (
        <InlineSpinner label={messages.calendar.loading} />
      ) : null}
      {calendarQuery.isError ? (
        <ErrorState
          error={calendarQuery.error}
          onRetry={() => void calendarQuery.refetch()}
        />
      ) : null}
      {calendarQuery.data && groups.length === 0 ? (
        <EmptyState
          title={messages.calendar.emptyTitle}
          description={messages.calendar.emptyDescription}
        />
      ) : null}
      {groups.length ? (
        <div className="calendar-list">
          {groups.map(([day, items]) => (
            <section className="calendar-day" key={day}>
              <header>
                <span className="calendar-day__date">
                  <strong>
                    {day === today
                      ? messages.calendar.today
                      : (formatDate(day, locale, {
                          weekday: "long",
                          timeZone: "UTC",
                        }) ?? messages.dates.unknown)}
                  </strong>
                  <small>
                    {/* Day keys are plain dates; format them without a
                        timezone shift so they never slide to the day
                        before for viewers west of UTC. */}
                    {formatDate(day, locale, {
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    }) ?? messages.dates.unknown}
                  </small>
                </span>
                <span>
                  {messages.calendar.releaseCount({ count: items.length })}
                </span>
              </header>
              <div className="calendar-day__items">
                {items.map((item) => {
                  const poster = imageUrl(item.posterPath, "w342");
                  return (
                    <article className="calendar-item" key={item.id}>
                      <div className="calendar-item__poster">
                        {poster ? (
                          <img src={poster} alt="" />
                        ) : (
                          <span>{initials(item.title)}</span>
                        )}
                      </div>
                      <div>
                        <h3>{item.title}</h3>
                        {item.subtitle ? <p>{item.subtitle}</p> : null}
                        <Badge tone={calendarTone(item.acquisitionState)}>
                          {statusLabel(item.acquisitionState, messages)}
                        </Badge>
                      </div>
                      <CalendarDays size={18} aria-hidden="true" />
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </Page>
  );
}
