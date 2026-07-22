import type { ScanReview } from "../types";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, FolderSearch, X } from "lucide-react";

import { Badge, Button } from "./ui";
import { api } from "../api/client";
import { imageUrl } from "../lib/format";

export function ScanReviewCard({
  review,
  busyTmdbId,
  dismissing = false,
  error,
  onResolve,
  onDismiss,
}: {
  review: ScanReview;
  busyTmdbId?: number;
  dismissing?: boolean;
  error?: string;
  onResolve: (tmdbId: number) => void;
  onDismiss: () => void;
}) {
  return (
    <article className="scan-review-card">
      <header className="scan-review-card__header">
        <div className="scan-review-card__title">
          <span className="scan-review-card__icon" aria-hidden="true">
            <FolderSearch size={19} />
          </span>
          <div>
            <h3>{review.title}</h3>
            <p>
              {review.year ?? "Year unknown"} · {review.files.length}{" "}
              {review.files.length === 1 ? "file" : "files"}
            </p>
          </div>
        </div>
        <Badge tone="warning">Needs a match</Badge>
      </header>
      <p className="scan-review-card__root" title={review.rootPath}>
        Found under {review.rootPath}
      </p>
      {review.candidates.length > 0 ? (
        <div className="scan-review-candidates" aria-label="TMDB candidates">
          {review.candidates.map((candidate) => {
            const poster = imageUrl(candidate.posterPath, "w342");
            return (
              <div className="scan-review-candidate" key={candidate.tmdbId}>
                <div className="scan-review-candidate__poster">
                  {poster ? <img src={poster} alt="" loading="lazy" /> : null}
                </div>
                <div className="scan-review-candidate__copy">
                  <strong>{candidate.title}</strong>
                  <span>{candidate.year ?? "Year unknown"}</span>
                  <p>{candidate.overview || "No description available."}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  busy={busyTmdbId === candidate.tmdbId}
                  disabled={busyTmdbId !== undefined || dismissing}
                  onClick={() => onResolve(candidate.tmdbId)}
                >
                  <Check size={15} /> Import this title
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="notice" role="status">
          No TMDB candidates were found. Rename the folder and scan again, or
          dismiss this review.
        </div>
      )}
      {error ? (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      ) : null}
      <footer className="scan-review-card__footer">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          busy={dismissing}
          disabled={busyTmdbId !== undefined}
          onClick={onDismiss}
        >
          <X size={15} /> Dismiss
        </Button>
      </footer>
    </article>
  );
}

export function ScanReviewPanel({ kind }: { kind: "movie" | "series" }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["library", "scan-reviews", kind],
    queryFn: ({ signal }) =>
      api.get("listScanReviews", {
        query: { status: "pending", kind },
        signal,
      }),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["library"] }),
      queryClient.invalidateQueries({ queryKey: ["activity"] }),
    ]);
  };
  const resolve = useMutation({
    mutationFn: ({ reviewId, tmdbId }: { reviewId: string; tmdbId: number }) =>
      api.post("resolveScanReview", {
        params: { id: reviewId },
        body: { tmdbId },
      }),
    onSuccess: refresh,
  });
  const dismiss = useMutation({
    mutationFn: (reviewId: string) =>
      api.post("dismissScanReview", { params: { id: reviewId } }),
    onSuccess: refresh,
  });

  if (query.isLoading || (!query.isError && !query.data?.reviews.length)) {
    return null;
  }
  if (query.isError) {
    return (
      <div className="notice notice--error" role="alert">
        Could not load scan reviews. {query.error.message}
      </div>
    );
  }

  return (
    <section className="scan-review-panel" aria-labelledby="scan-review-title">
      <header className="scan-review-panel__header">
        <div>
          <span className="eyebrow">Match review</span>
          <h2 id="scan-review-title">Choose the right TMDB title</h2>
          <p>
            Bobarr found ambiguous folders and will not guess. Confirm a match
            to import the recorded files.
          </p>
        </div>
        <span className="scan-review-panel__count">
          <AlertTriangle size={16} /> {query.data?.page.total ?? 0} pending
        </span>
      </header>
      <div className="scan-review-list">
        {query.data?.reviews.map((review) => {
          const resolvingThis = resolve.variables?.reviewId === review.id;
          const dismissingThis = dismiss.variables === review.id;
          let error: string | undefined;
          if (resolvingThis) error = resolve.error?.message;
          else if (dismissingThis) error = dismiss.error?.message;
          return (
            <ScanReviewCard
              key={review.id}
              review={review}
              busyTmdbId={
                resolvingThis && resolve.isPending
                  ? resolve.variables?.tmdbId
                  : undefined
              }
              dismissing={dismissingThis && dismiss.isPending}
              error={error}
              onResolve={(tmdbId) =>
                resolve.mutate({ reviewId: review.id, tmdbId })
              }
              onDismiss={() => dismiss.mutate(review.id)}
            />
          );
        })}
      </div>
    </section>
  );
}
