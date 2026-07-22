import type { CalendarItem } from "../types";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { useMemo } from "react";

import { api } from "../api/client";
import { collectionItems } from "../api/normalize";
import { Page } from "../components/Page";
import { Badge, EmptyState, ErrorState, InlineSpinner } from "../components/ui";
import { formatDate, imageUrl, initials } from "../lib/format";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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
  const today = isoDate(new Date());

  return (
    <Page
      eyebrow="Schedule"
      title="Coming to your screen"
      description="Release dates and upcoming episodes from every monitored title."
      wide
    >
      {calendarQuery.isLoading ? (
        <InlineSpinner label="Loading your calendar…" />
      ) : null}
      {calendarQuery.isError ? (
        <ErrorState
          error={calendarQuery.error}
          onRetry={() => void calendarQuery.refetch()}
        />
      ) : null}
      {calendarQuery.data && groups.length === 0 ? (
        <EmptyState
          title="Your calendar is clear"
          description="Upcoming movies and episodes will appear here once you monitor a show or film."
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
                      ? "Today"
                      : formatDate(day, { weekday: "long" })}
                  </strong>
                  <small>
                    {formatDate(day, { month: "short", day: "numeric" })}
                  </small>
                </span>
                <span>
                  {items.length} {items.length === 1 ? "release" : "releases"}
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
                          {item.acquisitionState}
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
