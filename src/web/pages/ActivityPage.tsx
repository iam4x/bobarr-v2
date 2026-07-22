import type { ApiPageInfo } from "../../contracts";
import type { ActivityEvent, Download, Job } from "../types";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Download as DownloadIcon,
  Files,
  FileUp,
  Link as LinkIcon,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import { api } from "../api/client";
import { collectionItems } from "../api/normalize";
import { Page } from "../components/Page";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  InlineSpinner,
  ProgressBar,
  SegmentedControl,
} from "../components/ui";
import {
  formatBytes,
  formatEta,
  formatRate,
  formatRelativeDate,
  toPercent,
} from "../lib/format";

type ActivityTab = "downloads" | "jobs" | "history";
type DownloadAction = "pause" | "resume" | "retry";
const DOWNLOAD_PAGE_SIZE = 50;
export const JOB_PAGE_SIZE = 20;

export const JOB_KIND_OPTIONS = [
  { value: "", label: "All job types" },
  { value: "media.acquire.v1", label: "Media acquisition" },
  { value: "acquisition.add-torrent", label: "Add torrent" },
  { value: "acquisition.organize-download", label: "Organize download" },
  { value: "library.scan.v1", label: "Library scan" },
  { value: "maintenance.reconcile.v1", label: "Reconcile services" },
  { value: "maintenance.search-missing.v1", label: "Search missing media" },
  { value: "maintenance.refresh-metadata.v1", label: "Refresh metadata" },
  { value: "maintenance.backup.v1", label: "Backup" },
  { value: "maintenance.cleanup.v1", label: "Cleanup" },
] as const;

export function formatJobKind(kind: string): string {
  return (
    JOB_KIND_OPTIONS.find((option) => option.value === kind)?.label ??
    kind.replaceAll(/[._-]+/g, " ")
  );
}

function downloadTone(
  state: Download["state"],
): "neutral" | "success" | "warning" | "danger" | "info" {
  if (["completed", "seeding"].includes(state)) return "success";
  if (state === "failed") return "danger";
  if (state === "paused") return "warning";
  if (["downloading", "checking", "organizing"].includes(state)) return "info";
  return "neutral";
}

function DownloadCard({
  download,
  busyAction,
  onAction,
  onCancel,
  busyFileIndex,
  onFileWanted,
}: {
  download: Download;
  busyAction?: DownloadAction;
  onAction: (action: DownloadAction) => void;
  onCancel: () => void;
  busyFileIndex?: number;
  onFileWanted: (index: number, wanted: boolean) => void;
}) {
  const progress = toPercent(download.progress);
  const canPause = ["queued", "downloading", "checking", "seeding"].includes(
    download.state,
  );
  const canResume = download.state === "paused";
  const canRetry = download.state === "failed";
  return (
    <article className="download-card">
      <div className="download-card__icon" aria-hidden="true">
        <DownloadIcon size={21} />
      </div>
      <div className="download-card__body">
        <div className="download-card__heading">
          <div>
            <h3>{download.title}</h3>
            <Badge tone={downloadTone(download.state)}>{download.state}</Badge>
          </div>
          <strong>{progress}%</strong>
        </div>
        <ProgressBar
          value={progress}
          label={`${download.title} download progress`}
        />
        <div className="download-card__stats">
          <span>
            <ArrowDown size={14} /> {formatRate(download.downloadRate)}
          </span>
          <span>
            <ArrowUp size={14} /> {formatRate(download.uploadRate)}
          </span>
          <span>
            {formatBytes(download.downloadedBytes)} /{" "}
            {formatBytes(download.totalBytes)}
          </span>
          <span>ETA {formatEta(download.etaSeconds)}</span>
        </div>
        {download.error ? (
          <div className="download-card__error">
            <AlertTriangle size={15} />
            {download.error}
          </div>
        ) : null}
        {download.files && download.files.length > 1 ? (
          <details className="download-files">
            <summary>
              <Files size={15} aria-hidden="true" /> Choose files ·{" "}
              {download.files.filter((file) => file.wanted).length}/
              {download.files.length}
            </summary>
            <div className="download-files__list">
              {download.files.map((file) => (
                <label className="download-file" key={file.index}>
                  <input
                    type="checkbox"
                    checked={file.wanted}
                    disabled={busyFileIndex === file.index}
                    onChange={(event) =>
                      onFileWanted(file.index, event.target.checked)
                    }
                  />
                  <span>
                    <strong>{file.name}</strong>
                    <small>
                      {formatBytes(file.bytesCompleted)} /{" "}
                      {formatBytes(file.length)} · {file.priority} priority
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </details>
        ) : null}
      </div>
      <div className="download-card__actions">
        {canPause ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            busy={busyAction === "pause"}
            onClick={() => onAction("pause")}
          >
            <CirclePause size={16} /> Pause
          </Button>
        ) : null}
        {canResume ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            busy={busyAction === "resume"}
            onClick={() => onAction("resume")}
          >
            <CirclePlay size={16} /> Resume
          </Button>
        ) : null}
        {canRetry ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            busy={busyAction === "retry"}
            onClick={() => onAction("retry")}
          >
            <RotateCcw size={16} /> Retry
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <Trash2 size={16} /> Remove
        </Button>
      </div>
    </article>
  );
}

export function DownloadRemovalTitle({ title }: { title: string }) {
  return (
    <p className="download-remove-title">
      <strong title={title}>{title}</strong>
    </p>
  );
}

function AddDownloadDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [source, setSource] = useState<"magnet" | "torrent">("magnet");
  const [magnet, setMagnet] = useState("");
  const [file, setFile] = useState<File>();
  const [validationError, setValidationError] = useState<string>();

  const addMutation = useMutation({
    mutationFn: async () => {
      if (source === "magnet") {
        if (!magnet.trim().startsWith("magnet:?"))
          throw new Error("Enter a valid magnet URI.");
        return api.post("createDownload", {
          body: { magnet: magnet.trim() },
        });
      }
      if (!file) throw new Error("Choose a .torrent file first.");
      const form = new FormData();
      form.set("torrent", file);
      return api.post("createDownload", { body: form });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["downloads"] });
      onClose();
      setMagnet("");
      setFile(undefined);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setValidationError(undefined);
    addMutation.mutate(undefined, {
      onError: (error) => setValidationError(error.message),
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a download"
      description="Only magnets and capped torrent metainfo files are accepted."
      size="sm"
    >
      <form className="stack" onSubmit={submit}>
        <SegmentedControl
          label="Download source"
          value={source}
          options={[
            { value: "magnet", label: "Magnet link" },
            { value: "torrent", label: ".torrent file" },
          ]}
          onChange={setSource}
        />
        {source === "magnet" ? (
          <Field
            label="Magnet URI"
            value={magnet}
            placeholder="magnet:?xt=urn:btih:…"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setMagnet(event.target.value)}
          />
        ) : (
          <label className="file-drop">
            <FileUp size={22} aria-hidden="true" />
            <span>
              <strong>{file?.name ?? "Choose a .torrent file"}</strong>
              <small>Metainfo only · size limit is enforced by Bobarr</small>
            </span>
            <input
              type="file"
              accept=".torrent,application/x-bittorrent"
              onChange={(event) => setFile(event.target.files?.[0])}
            />
          </label>
        )}
        {validationError ? (
          <div className="notice notice--error" role="alert">
            {validationError}
          </div>
        ) : null}
        <div className="dialog-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={addMutation.isPending}>
            {source === "magnet" ? (
              <LinkIcon size={16} />
            ) : (
              <FileUp size={16} />
            )}{" "}
            Add download
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function JobsList({
  jobs,
  busyJobId,
  onCancel,
  onRetry,
}: {
  jobs: Job[];
  busyJobId?: string;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  if (!jobs.length)
    return (
      <EmptyState
        title="No background work"
        description="Scheduled searches, scans, and organization jobs will appear here."
      />
    );
  return (
    <div className="job-list">
      {jobs.map((job) => {
        let tone: "danger" | "success" | "warning" | "neutral" = "neutral";
        if (job.state === "failed") tone = "danger";
        else if (job.state === "completed") tone = "success";
        else if (job.state === "retrying") tone = "warning";
        return (
          <article className="job-card" key={job.id}>
            <span
              className={`job-card__state job-card__state--${job.state}`}
              aria-hidden="true"
            />
            <div>
              <h3>{formatJobKind(job.type)}</h3>
              <p>
                Attempt {job.attempts} of {job.maxAttempts}
                {job.runAt ? ` · ${formatRelativeDate(job.runAt)}` : ""}
              </p>
              {job.error ? (
                <small className="danger-text">{job.error}</small>
              ) : null}
            </div>
            <div className="job-card__actions">
              <Badge tone={tone}>{job.state}</Badge>
              {job.state === "failed" || job.state === "cancelled" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  busy={busyJobId === job.id}
                  onClick={() => onRetry(job.id)}
                >
                  <RotateCcw size={15} /> Retry
                </Button>
              ) : null}
              {job.state === "pending" || job.state === "running" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  busy={busyJobId === job.id}
                  onClick={() => onCancel(job.id)}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function JobFilterBar({
  kind,
  busy,
  onChange,
}: {
  kind: string;
  busy: boolean;
  onChange: (kind: string) => void;
}) {
  return (
    <div className="job-browser__toolbar">
      <label className="compact-select">
        <span>Job type</span>
        <select value={kind} onChange={(event) => onChange(event.target.value)}>
          {JOB_KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {busy ? (
        <span className="job-browser__loading" role="status">
          Updating jobs…
        </span>
      ) : null}
    </div>
  );
}

export function JobPagination({
  page,
  busy,
  onPrevious,
  onNext,
}: {
  page: ApiPageInfo;
  busy: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const first = page.total === 0 ? 0 : page.offset + 1;
  const last = Math.min(page.offset + page.limit, page.total);
  const hasPrevious = page.offset > 0;
  const hasNext = page.offset + page.limit < page.total;

  return (
    <nav className="job-pagination" aria-label="Jobs pagination">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy || !hasPrevious}
        onClick={onPrevious}
      >
        <ChevronLeft size={16} /> Previous
      </Button>
      <span aria-live="polite">
        {first}–{last} of {page.total}
      </span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy || !hasNext}
        onClick={onNext}
      >
        Next <ChevronRight size={16} />
      </Button>
    </nav>
  );
}

function QueryTabContent({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (loading) return <InlineSpinner />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  return children;
}

function HistoryList({ events }: { events: ActivityEvent[] }) {
  if (!events.length)
    return (
      <EmptyState
        title="Nothing to report yet"
        description="Acquisition, library, and service events will build a readable history here."
      />
    );
  return (
    <ol className="timeline">
      {events.map((event) => (
        <li key={event.id}>
          <span
            className={`timeline__dot timeline__dot--${event.level}`}
            aria-hidden="true"
          >
            {event.level === "success" ? <CheckCircle2 size={14} /> : null}
          </span>
          <div>
            <strong>{event.message}</strong>
            <span>
              {event.type.replaceAll("_", " ")} ·{" "}
              {formatRelativeDate(event.createdAt)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ActivityPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ActivityTab>("downloads");
  const [addOpen, setAddOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Download | null>(null);
  const [deleteData, setDeleteData] = useState(false);
  const [jobKind, setJobKind] = useState("");
  const [jobOffset, setJobOffset] = useState(0);
  const downloadsQuery = useInfiniteQuery({
    queryKey: ["downloads"],
    queryFn: ({ pageParam, signal }) =>
      api.get("listDownloads", {
        query: { limit: DOWNLOAD_PAGE_SIZE, offset: pageParam },
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.page.offset + lastPage.downloads.length;
      return nextOffset < lastPage.page.total ? nextOffset : undefined;
    },
    refetchInterval: 5_000,
  });
  const jobsQuery = useQuery({
    queryKey: ["jobs", { kind: jobKind, offset: jobOffset }],
    queryFn: ({ signal }) =>
      api.get("listJobs", {
        query: {
          limit: JOB_PAGE_SIZE,
          offset: jobOffset,
          kind: jobKind || undefined,
        },
        signal,
      }),
    enabled: tab === "jobs",
  });
  const historyQuery = useQuery({
    queryKey: ["activity"],
    queryFn: ({ signal }) => api.get("activity", { signal }),
    enabled: tab === "history",
  });
  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: DownloadAction }) => {
      let route: "pauseDownload" | "resumeDownload" | "retryDownload";
      if (action === "pause") route = "pauseDownload";
      else if (action === "resume") route = "resumeDownload";
      else route = "retryDownload";
      return api.post(route, { params: { id } });
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["downloads"] }),
  });
  const cancelMutation = useMutation({
    mutationFn: () => {
      if (!cancelTarget) throw new Error("Select a download first.");
      return api.delete("removeDownload", {
        params: { id: cancelTarget.id },
        body: { deleteData },
      });
    },
    onSuccess: () => {
      setCancelTarget(null);
      setDeleteData(false);
      void queryClient.invalidateQueries({ queryKey: ["downloads"] });
      void queryClient.invalidateQueries({ queryKey: ["library"] });
      void queryClient.invalidateQueries({ queryKey: ["calendar"] });
    },
  });
  const fileMutation = useMutation({
    mutationFn: ({
      id,
      index,
      wanted,
    }: {
      id: string;
      index: number;
      wanted: boolean;
    }) =>
      api.patch("selectDownloadFiles", {
        params: { id },
        body: wanted ? { wanted: [index] } : { unwanted: [index] },
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["downloads"] }),
  });
  const jobActionMutation = useMutation({
    mutationFn: async ({
      id,
      action,
    }: {
      id: string;
      action: "cancel" | "retry";
    }) => {
      if (action === "cancel") {
        await api.delete("cancelJob", { params: { id } });
      } else {
        await api.post("retryJob", { params: { id } });
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
  const downloads =
    downloadsQuery.data?.pages.flatMap((page) => collectionItems(page)) ?? [];

  useEffect(() => {
    const total = jobsQuery.data?.page.total;
    if (total === undefined) return;
    const lastOffset =
      total === 0 ? 0 : Math.floor((total - 1) / JOB_PAGE_SIZE) * JOB_PAGE_SIZE;
    if (jobOffset > lastOffset) setJobOffset(lastOffset);
  }, [jobOffset, jobsQuery.data?.page.total]);

  return (
    <Page
      eyebrow="Operations"
      title="Activity"
      description="Downloads, acquisition work, and system events—without leaving Bobarr."
      actions={
        <Button type="button" onClick={() => setAddOpen(true)}>
          <Plus size={17} /> Add download
        </Button>
      }
      wide
    >
      <div className="activity-toolbar">
        <SegmentedControl
          label="Activity view"
          value={tab}
          options={[
            {
              value: "downloads",
              label: `Downloads${downloads.length ? ` · ${downloads.length}` : ""}`,
            },
            { value: "jobs", label: "Jobs" },
            { value: "history", label: "History" },
          ]}
          onChange={setTab}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void queryClient.invalidateQueries()}
        >
          <RefreshCw size={16} /> Refresh
        </Button>
      </div>
      {tab === "downloads" ? (
        <>
          {downloadsQuery.isLoading ? (
            <InlineSpinner label="Contacting Transmission…" />
          ) : null}
          {downloadsQuery.isError ? (
            <ErrorState
              error={downloadsQuery.error}
              onRetry={() => void downloadsQuery.refetch()}
            />
          ) : null}
          {fileMutation.isError ? (
            <div className="notice notice--error" role="alert">
              {fileMutation.error.message}
            </div>
          ) : null}
          {downloadsQuery.data && downloads.length === 0 ? (
            <EmptyState
              title="Nothing is downloading"
              description="Automatic acquisitions and manually added torrents will appear here."
              action={
                <Button type="button" onClick={() => setAddOpen(true)}>
                  <Plus size={16} /> Add download
                </Button>
              }
            />
          ) : null}
          <div className="download-list">
            {downloads.map((download) => (
              <DownloadCard
                key={download.id}
                download={download}
                busyAction={
                  actionMutation.isPending &&
                  actionMutation.variables?.id === download.id
                    ? actionMutation.variables.action
                    : undefined
                }
                onAction={(action) =>
                  actionMutation.mutate({ id: download.id, action })
                }
                onCancel={() => setCancelTarget(download)}
                busyFileIndex={
                  fileMutation.isPending &&
                  fileMutation.variables?.id === download.id
                    ? fileMutation.variables.index
                    : undefined
                }
                onFileWanted={(index, wanted) =>
                  fileMutation.mutate({ id: download.id, index, wanted })
                }
              />
            ))}
          </div>
          {downloadsQuery.hasNextPage ? (
            <div className="load-more-row">
              <Button
                type="button"
                variant="secondary"
                busy={downloadsQuery.isFetchingNextPage}
                onClick={() => void downloadsQuery.fetchNextPage()}
              >
                Load older downloads
              </Button>
            </div>
          ) : null}
          {actionMutation.isError ? (
            <div className="notice notice--error">
              {actionMutation.error.message}
            </div>
          ) : null}
        </>
      ) : null}
      {tab === "jobs" ? (
        <div className="job-browser">
          <JobFilterBar
            kind={jobKind}
            busy={jobsQuery.isFetching && !jobsQuery.isLoading}
            onChange={(kind) => {
              setJobKind(kind);
              setJobOffset(0);
            }}
          />
          <QueryTabContent
            loading={jobsQuery.isLoading}
            error={jobsQuery.error}
            onRetry={() => void jobsQuery.refetch()}
          >
            <JobsList
              jobs={collectionItems(jobsQuery.data)}
              busyJobId={
                jobActionMutation.isPending
                  ? jobActionMutation.variables?.id
                  : undefined
              }
              onCancel={(id) =>
                jobActionMutation.mutate({ id, action: "cancel" })
              }
              onRetry={(id) =>
                jobActionMutation.mutate({ id, action: "retry" })
              }
            />
            {jobsQuery.data ? (
              <JobPagination
                page={jobsQuery.data.page}
                busy={jobsQuery.isFetching}
                onPrevious={() =>
                  setJobOffset((offset) => Math.max(0, offset - JOB_PAGE_SIZE))
                }
                onNext={() => setJobOffset((offset) => offset + JOB_PAGE_SIZE)}
              />
            ) : null}
            {jobActionMutation.isError ? (
              <div className="notice notice--error" role="alert">
                {jobActionMutation.error.message}
              </div>
            ) : null}
          </QueryTabContent>
        </div>
      ) : null}
      {tab === "history" ? (
        <QueryTabContent
          loading={historyQuery.isLoading}
          error={historyQuery.error}
          onRetry={() => void historyQuery.refetch()}
        >
          <HistoryList events={collectionItems(historyQuery.data)} />
        </QueryTabContent>
      ) : null}
      <AddDownloadDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <Dialog
        open={Boolean(cancelTarget)}
        title="Remove download?"
        description="The torrent can be removed while keeping its downloaded data. If it is linked to library media, automatic monitoring stops for that movie, season, or episode so Bobarr will not immediately add it again."
        onClose={() => setCancelTarget(null)}
        size="sm"
      >
        <div className="stack">
          {cancelTarget ? (
            <DownloadRemovalTitle title={cancelTarget.title} />
          ) : null}
          <label className="check-row">
            <input
              type="checkbox"
              checked={deleteData}
              onChange={(event) => setDeleteData(event.target.checked)}
            />
            <span>
              <strong>Also delete downloaded data</strong>
              <small>
                This is permanent and may affect organized files when using move
                or symlink.
              </small>
            </span>
          </label>
          {cancelMutation.isError ? (
            <div className="notice notice--error">
              {cancelMutation.error.message}
            </div>
          ) : null}
          <div className="dialog-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCancelTarget(null)}
            >
              Keep download
            </Button>
            <Button
              type="button"
              variant="danger"
              busy={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              <Trash2 size={16} /> Remove
            </Button>
          </div>
        </div>
      </Dialog>
    </Page>
  );
}
