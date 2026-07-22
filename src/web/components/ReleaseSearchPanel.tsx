import type { ReleaseCandidate } from "../types";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw, Search, Users } from "lucide-react";
import { useId, useState } from "react";

import { Badge, Button, EmptyState, ErrorState, InlineSpinner } from "./ui";
import { api } from "../api/client";
import { collectionItems } from "../api/normalize";
import { formatBytes, formatDate } from "../lib/format";

export interface ManualReleaseTarget {
  tmdbId: number;
  kind: "movie" | "series";
  season?: number;
  episode?: number;
}

export function ReleaseCard({
  release,
  onGrab,
  isGrabbing,
  replacement = false,
}: {
  release: ReleaseCandidate;
  onGrab: (release: ReleaseCandidate) => void;
  isGrabbing: boolean;
  replacement?: boolean;
}) {
  return (
    <article
      className={`release-card ${release.eligible ? "" : "release-card--rejected"}`}
    >
      <div className="release-card__main">
        <h4>{release.title}</h4>
        <div className="release-card__meta">
          <span>{release.indexer}</span>
          <span>{formatBytes(release.size)}</span>
          <span>
            <Users size={14} aria-hidden="true" /> {release.seeders} seeders
          </span>
          {release.quality ? <span>{release.quality}</span> : null}
          {release.publishedAt ? (
            <span>{formatDate(release.publishedAt)}</span>
          ) : null}
        </div>
        {!release.eligible && release.reasons.length ? (
          <ul className="release-reasons" aria-label="Exclusion reasons">
            {release.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <Badge
        className="release-card__score"
        tone={release.eligible ? "success" : "danger"}
      >
        {release.eligible ? `Score ${release.score}` : "Excluded"}
      </Badge>
      <Button
        className="release-card__action"
        type="button"
        size="sm"
        variant={release.eligible ? "primary" : "secondary"}
        disabled={!release.eligible}
        busy={isGrabbing}
        onClick={() => onGrab(release)}
      >
        {replacement ? (
          <RefreshCw size={16} aria-hidden="true" />
        ) : (
          <Download size={16} aria-hidden="true" />
        )}
        {replacement ? "Replace" : "Grab"}
      </Button>
    </article>
  );
}

export function ReleaseSearchPanel({
  target,
  onQueued,
}: {
  target: ManualReleaseTarget;
  onQueued?: (candidateId: string) => void;
}) {
  const queryClient = useQueryClient();
  const queryInputId = useId();
  const queryHintId = `${queryInputId}-hint`;
  const [queuedTitle, setQueuedTitle] = useState<string>();
  const [draftQuery, setDraftQuery] = useState<string | null>(null);
  const [submittedQuery, setSubmittedQuery] = useState<string>();
  const releaseQuery = useQuery({
    queryKey: [
      "releases",
      target.kind,
      target.tmdbId,
      target.season,
      target.episode,
      submittedQuery,
    ],
    queryFn: ({ signal }) =>
      api.get("searchReleases", {
        query: {
          ...target,
          ...(submittedQuery ? { query: submittedQuery } : {}),
        },
        signal,
      }),
  });
  const replacementRequired = releaseQuery.data?.replacementRequired ?? false;
  const grabMutation = useMutation<unknown, Error, ReleaseCandidate>({
    mutationFn: (candidate: ReleaseCandidate) => {
      if (!replacementRequired) {
        return api.post("createDownload", {
          body: { candidateId: candidate.id },
        });
      }
      const mediaId = releaseQuery.data?.mediaId ?? candidate.mediaId;
      if (!mediaId) {
        throw new Error(
          "This replacement is no longer bound to library media.",
        );
      }
      return api.post("replaceLibraryItem", {
        params: { id: mediaId },
        body: { candidateId: candidate.id },
      });
    },
    onSuccess: (_download, candidate) => {
      setQueuedTitle(candidate.title);
      onQueued?.(candidate.id);
      void queryClient.invalidateQueries({ queryKey: ["downloads"] });
      void queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });
  const releases = collectionItems(releaseQuery.data);
  const visibleQuery = draftQuery ?? releaseQuery.data?.query ?? "";

  const submitQuery = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = visibleQuery.trim();
    if (!query) return;
    setDraftQuery(query);
    setQueuedTitle(undefined);
    if (query === submittedQuery) {
      void releaseQuery.refetch();
    } else {
      setSubmittedQuery(query);
    }
  };

  return (
    <section className="release-results" aria-live="polite">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Jackett</span>
          <h3>Release candidates</h3>
        </div>
      </div>
      <form className="release-query" onSubmit={submitQuery}>
        <div className="field release-query__field">
          <label className="field__label" htmlFor={queryInputId}>
            Jackett search query
          </label>
          <div className="release-query__controls">
            <input
              id={queryInputId}
              type="search"
              value={visibleQuery}
              placeholder="Generating a query…"
              maxLength={300}
              autoComplete="off"
              spellCheck={false}
              required
              aria-describedby={queryHintId}
              onChange={(event) => setDraftQuery(event.currentTarget.value)}
            />
            <Button
              className="release-query__submit"
              type="submit"
              variant="secondary"
              busy={releaseQuery.isFetching}
              disabled={!visibleQuery.trim()}
            >
              <Search size={16} aria-hidden="true" /> Search Jackett
            </Button>
          </div>
          <span className="field__hint" id={queryHintId}>
            Edit the generated query and search again. Media matching and
            candidate binding still use the selected title and episode.
          </span>
        </div>
      </form>
      {replacementRequired ? (
        <div className="notice notice--warning" role="note">
          Choosing a candidate starts an explicit replacement. Any active Bobarr
          download for this item is stopped and its incomplete data is removed;
          an organized library file remains until its replacement is ready.
        </div>
      ) : null}
      {queuedTitle ? (
        <div className="notice notice--success" role="status">
          {replacementRequired ? "Replacement" : "Release"} queued:{" "}
          {queuedTitle}. Track it in Activity.
        </div>
      ) : null}
      {grabMutation.isError ? (
        <div className="notice notice--error" role="alert">
          {grabMutation.error.message}
        </div>
      ) : null}
      {releaseQuery.isLoading ? (
        <InlineSpinner label="Searching indexers…" />
      ) : null}
      {releaseQuery.isError ? (
        <ErrorState
          error={releaseQuery.error}
          onRetry={() => void releaseQuery.refetch()}
        />
      ) : null}
      {releaseQuery.data && releases.length === 0 ? (
        <EmptyState
          title="No releases found"
          description="Try again later or adjust your release profile in Settings."
        />
      ) : null}
      {releaseQuery.data ? (
        <div className="release-list">
          {releases.map((release) => (
            <ReleaseCard
              key={release.id}
              release={release}
              replacement={replacementRequired}
              isGrabbing={
                grabMutation.isPending &&
                grabMutation.variables?.id === release.id
              }
              onGrab={(candidate) => grabMutation.mutate(candidate)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
