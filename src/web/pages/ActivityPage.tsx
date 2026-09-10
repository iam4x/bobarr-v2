import type { ApiPageInfo } from "../../contracts";
import type { ActivityEvent, Download, Job, JobDetails } from "../types";

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
import { collectionItems, normalizeJobDetails } from "../api/normalize";
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
  SelectControl,
} from "../components/ui";
import { en, type Messages } from "../i18n/en";
import { useUi } from "../i18n/ui";
import {
  formatBytes,
  formatEta,
  formatRate,
  formatRelativeDate,
  toPercent,
} from "../lib/format";

type ActivityTab = "downloads" | "jobs" | "history";
type DownloadAction = "pause" | "resume" | "retry";
type DownloadFilter = "active" | "completed" | "all";
const DOWNLOAD_PAGE_SIZE = 50;
export const JOB_PAGE_SIZE = 20;

const JOB_KIND_VALUES = [
  "media.acquire.v1",
  "acquisition.add-torrent",
  "acquisition.organize-download",
  "library.scan.v1",
  "maintenance.reconcile.v1",
  "maintenance.search-missing.v1",
  "maintenance.refresh-metadata.v1",
  "maintenance.backup.v1",
  "maintenance.cleanup.v1",
] as const;

const MANUAL_JOB_VALUES = [
  "library.scan.v1",
  "maintenance.reconcile.v1",
  "maintenance.search-missing.v1",
  "maintenance.refresh-metadata.v1",
  "maintenance.backup.v1",
  "maintenance.cleanup.v1",
] as const;

export function formatJobKind(kind: string, messages: Messages = en): string {
  const labels: Record<string, string> = messages.activity.jobKinds;
  const labeled = labels[kind];
  if (labeled) return labeled;
  return kind.replaceAll(/[._-]+/g, " ");
}

function jobKindOptions(messages: Messages) {
  return [
    { value: "", label: messages.activity.allJobTypes },
    ...JOB_KIND_VALUES.map((value) => ({
      value,
      label: formatJobKind(value, messages),
    })),
  ];
}

function manualJobOptions(messages: Messages) {
  return MANUAL_JOB_VALUES.map((value) => ({
    value,
    label: formatJobKind(value, messages),
  }));
}

export function DownloadFilterBar({
  value,
  onChange,
}: {
  value: DownloadFilter;
  onChange: (value: DownloadFilter) => void;
}) {
  const { messages } = useUi();
  return (
    <label className="compact-select download-filter">
      <span>{messages.activity.downloadStatus}</span>
      <SelectControl
        value={value}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (next === "active" || next === "completed" || next === "all") {
            onChange(next);
          }
        }}
      >
        <option value="active">{messages.activity.active}</option>
        <option value="completed">{messages.activity.completed}</option>
        <option value="all">{messages.activity.all}</option>
      </SelectControl>
    </label>
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
  canMutate,
  busyAction,
  onAction,
  onCancel,
  busyFileIndex,
  onFileWanted,
}: {
  download: Download;
  canMutate: boolean;
  busyAction?: DownloadAction;
  onAction: (action: DownloadAction) => void;
  onCancel: () => void;
  busyFileIndex?: number;
  onFileWanted: (index: number, wanted: boolean) => void;
}) {
  const { messages } = useUi();
  const progress = toPercent(download.progress);
  const canPause = ["queued", "downloading", "checking", "seeding"].includes(
    download.state,
  );
  const canResume = download.state === "paused";
  const canRetry = download.state === "failed";
  const stateLabels: Record<string, string> = {
    searching: messages.status.searching,
    queued: messages.status.queued,
    downloading: messages.status.downloading,
    organizing: messages.status.organizing,
    available: messages.status.available,
    missing: messages.status.missing,
    failed: messages.status.failed,
    paused: messages.status.paused,
    seeding: messages.status.seeding,
    checking: messages.status.checking,
    completed: messages.status.completed,
  };
  return (
    <article className="download-card">
      <div className="download-card__icon" aria-hidden="true">
        <DownloadIcon size={21} />
      </div>
      <div className="download-card__body">
        <div className="download-card__heading">
          <div>
            <h3>{download.title}</h3>
            <Badge tone={downloadTone(download.state)}>
              {stateLabels[download.state] ?? download.state}
            </Badge>
          </div>
          <strong>{progress}%</strong>
        </div>
        <ProgressBar
          value={progress}
          label={messages.common.downloadProgress({ title: download.title })}
        />
        <div className="download-card__stats">
          <span>
            <ArrowDown size={14} /> {formatRate(download.downloadRate)}
          </span>
          <span>
            <ArrowUp size={14} /> {formatRate(download.uploadRate)}
          </span>
          <span>
            {messages.common.bytesOf({
              from: formatBytes(download.downloadedBytes),
              to: formatBytes(download.totalBytes),
            })}
          </span>
          <span>
            {messages.common.eta({ value: formatEta(download.etaSeconds) })}
          </span>
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
              <Files size={15} aria-hidden="true" />{" "}
              {messages.activity.chooseFiles} ·{" "}
              {download.files.filter((file) => file.wanted).length}/
              {download.files.length}
            </summary>
            <div className="download-files__list">
              {download.files.map((file) => (
                <label className="download-file" key={file.index}>
                  <input
                    type="checkbox"
                    checked={file.wanted}
                    disabled={!canMutate || busyFileIndex === file.index}
                    onChange={(event) =>
                      onFileWanted(file.index, event.target.checked)
                    }
                  />
                  <span>
                    <strong>{file.name}</strong>
                    <small>
                      {messages.common.bytesOf({
                        from: formatBytes(file.bytesCompleted),
                        to: formatBytes(file.length),
                      })}{" "}
                      · {messages.activity.priority({ value: file.priority })}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </details>
        ) : null}
      </div>
      {canMutate ? (
        <div className="download-card__actions">
          {canPause ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              busy={busyAction === "pause"}
              onClick={() => onAction("pause")}
            >
              <CirclePause size={16} /> {messages.activity.pause}
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
              <CirclePlay size={16} /> {messages.activity.resume}
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
              <RotateCcw size={16} /> {messages.activity.retry}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            <Trash2 size={16} /> {messages.activity.remove}
          </Button>
        </div>
      ) : null}
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
  const { messages } = useUi();
  const queryClient = useQueryClient();
  const [source, setSource] = useState<"magnet" | "torrent">("magnet");
  const [magnet, setMagnet] = useState("");
  const [file, setFile] = useState<File>();
  const [validationError, setValidationError] = useState<string>();

  const addMutation = useMutation({
    mutationFn: async () => {
      if (source === "magnet") {
        if (!magnet.trim().startsWith("magnet:?"))
          throw new Error(messages.activity.invalidMagnet);
        return api.post("createDownload", {
          body: { magnet: magnet.trim() },
        });
      }
      if (!file) throw new Error(messages.activity.chooseTorrentFirst);
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
      title={messages.activity.addDownload}
      description={messages.activity.addDownloadDescription}
      size="sm"
    >
      <form className="stack" onSubmit={submit}>
        <SegmentedControl
          label={messages.activity.downloadSource}
          value={source}
          options={[
            { value: "magnet", label: messages.activity.magnetLink },
            { value: "torrent", label: messages.activity.torrentFile },
          ]}
          onChange={setSource}
        />
        {source === "magnet" ? (
          <Field
            label={messages.activity.magnetUri}
            value={magnet}
            placeholder={messages.activity.magnetPlaceholder}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setMagnet(event.target.value)}
          />
        ) : (
          <label className="file-drop">
            <FileUp size={22} aria-hidden="true" />
            <span>
              <strong>{file?.name ?? messages.activity.chooseTorrent}</strong>
              <small>{messages.activity.torrentHint}</small>
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
            {messages.common.cancel}
          </Button>
          <Button type="submit" busy={addMutation.isPending}>
            {source === "magnet" ? (
              <LinkIcon size={16} />
            ) : (
              <FileUp size={16} />
            )}{" "}
            {messages.activity.addDownloadAction}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function JobsList({
  jobs,
  busyJobId,
  onOpen,
  onCancel,
  onRetry,
}: {
  jobs: Job[];
  busyJobId?: string;
  onOpen: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const { messages, locale } = useUi();
  if (!jobs.length)
    return (
      <EmptyState
        title={messages.activity.noJobsTitle}
        description={messages.activity.noJobsDescription}
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
            <button
              className="job-card__summary"
              type="button"
              onClick={() => onOpen(job.id)}
            >
              <h3>{formatJobKind(job.type, messages)}</h3>
              <p>
                {job.state === "pending" &&
                new Date(job.runAt).getTime() > Date.now()
                  ? messages.activity.scheduled({
                      when: formatRelativeDate(job.runAt, locale),
                    })
                  : messages.activity.attemptOf({
                      attempts: job.attempts,
                      max: job.maxAttempts,
                    })}
              </p>
              {job.error ? (
                <small className="danger-text">{job.error}</small>
              ) : null}
            </button>
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
                  <RotateCcw size={15} /> {messages.activity.retry}
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
                  {messages.common.cancel}
                </Button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function JobDetailsDialog({
  job,
  loading,
  error,
  onClose,
}: {
  job?: JobDetails;
  loading: boolean;
  error: unknown;
  onClose: () => void;
}) {
  const { messages } = useUi();
  return (
    <Dialog
      open={loading || error !== null || job !== undefined}
      title={
        job ? formatJobKind(job.type, messages) : messages.activity.jobDetails
      }
      description={messages.activity.jobDetailsDescription}
      onClose={onClose}
      size="lg"
    >
      {loading ? (
        <InlineSpinner label={messages.activity.loadingJobLog} />
      ) : null}
      {error ? <ErrorState error={error} /> : null}
      {job ? (
        <div className="job-details">
          <dl className="job-details__facts">
            <div>
              <dt>{messages.activity.jobStatus}</dt>
              <dd>{job.state}</dd>
            </div>
            <div>
              <dt>{messages.activity.attempts}</dt>
              <dd>
                {messages.activity.of({
                  from: job.attempts,
                  to: job.maxAttempts,
                })}
              </dd>
            </div>
            <div>
              <dt>{messages.activity.scheduledAt}</dt>
              <dd>{new Date(job.runAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>{messages.activity.jobId}</dt>
              <dd>{job.id}</dd>
            </div>
          </dl>
          <section>
            <h3>{messages.activity.executionLog}</h3>
            {job.logs.length ? (
              <ol className="job-log">
                {job.logs.map((entry, index) => (
                  <li key={`${entry.timestamp}-${entry.event}-${index}`}>
                    <span
                      className={`job-log__level job-log__level--${entry.level}`}
                    >
                      {entry.level}
                    </span>
                    <div>
                      <strong>{entry.event}</strong>
                      <time dateTime={entry.timestamp}>
                        {new Date(entry.timestamp).toLocaleString()}
                      </time>
                      {entry.message ? <p>{entry.message}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="job-details__empty-log">
                {messages.activity.emptyJobLog}
              </p>
            )}
          </section>
          <details>
            <summary>{messages.activity.jobPayload}</summary>
            <pre>{JSON.stringify(job.payload ?? {}, null, 2)}</pre>
          </details>
        </div>
      ) : null}
    </Dialog>
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
  const { messages } = useUi();
  return (
    <div className="job-browser__toolbar">
      <label className="compact-select">
        <span>{messages.activity.jobType}</span>
        <SelectControl
          value={kind}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {jobKindOptions(messages).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectControl>
      </label>
      {busy ? (
        <span className="job-browser__loading" role="status">
          {messages.activity.updatingJobs}
        </span>
      ) : null}
    </div>
  );
}

export function ManualJobControls({
  kind,
  busy,
  onChange,
  onRun,
}: {
  kind: string;
  busy: boolean;
  onChange: (kind: string) => void;
  onRun: () => void;
}) {
  const { messages } = useUi();
  return (
    <div className="manual-job-controls">
      <div>
        <strong>{messages.activity.runMaintenance}</strong>
        <small>{messages.activity.runMaintenanceHint}</small>
      </div>
      <label className="compact-select">
        <span>{messages.activity.task}</span>
        <SelectControl
          value={kind}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {manualJobOptions(messages).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectControl>
      </label>
      <Button type="button" busy={busy} onClick={onRun}>
        <CirclePlay size={16} /> {messages.activity.runJob}
      </Button>
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
  const { messages } = useUi();

  return (
    <nav
      className="job-pagination"
      aria-label={messages.activity.jobsPagination}
    >
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy || !hasPrevious}
        onClick={onPrevious}
      >
        <ChevronLeft size={16} /> {messages.activity.previous}
      </Button>
      <span aria-live="polite">
        {messages.activity.pageRange({
          from: first,
          to: last,
          total: page.total,
        })}
      </span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy || !hasNext}
        onClick={onNext}
      >
        {messages.activity.next} <ChevronRight size={16} />
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
  const { messages, locale } = useUi();
  if (!events.length)
    return (
      <EmptyState
        title={messages.activity.noHistoryTitle}
        description={messages.activity.noHistoryDescription}
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
              {formatRelativeDate(event.createdAt, locale)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ActivityPage() {
  const { messages } = useUi();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: ({ signal }) => api.get("currentSession", { signal }),
  });
  const canManageSettings =
    sessionQuery.data?.capabilities?.canManageSettings === true;
  const [tab, setTab] = useState<ActivityTab>("downloads");
  const [addOpen, setAddOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Download | null>(null);
  const [deleteData, setDeleteData] = useState(false);
  const [downloadFilter, setDownloadFilter] =
    useState<DownloadFilter>("active");
  const [jobKind, setJobKind] = useState("");
  const [jobOffset, setJobOffset] = useState(0);
  const [manualJobKind, setManualJobKind] = useState("library.scan.v1");
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const downloadsQuery = useInfiniteQuery({
    queryKey: ["downloads", { completion: downloadFilter }],
    queryFn: ({ pageParam, signal }) =>
      api.get("listDownloads", {
        query: {
          limit: DOWNLOAD_PAGE_SIZE,
          offset: pageParam,
          completion: downloadFilter,
        },
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
    refetchInterval: 2_000,
  });
  const jobDetailsQuery = useQuery({
    queryKey: ["job", selectedJobId],
    queryFn: async ({ signal }) =>
      normalizeJobDetails(
        await api.get("getJob", {
          params: { id: selectedJobId! },
          signal,
        }),
      ),
    enabled: selectedJobId !== undefined,
    refetchInterval: selectedJobId === undefined ? false : 2_000,
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
      if (!cancelTarget) throw new Error(messages.activity.selectDownloadFirst);
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
  const createJobMutation = useMutation({
    mutationFn: (kind: string) =>
      api.post("createJob", { body: { kind, payload: {} } }),
    onSuccess: (_job, kind) => {
      setJobKind(kind);
      setJobOffset(0);
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
  const downloads =
    downloadsQuery.data?.pages.flatMap((page) => collectionItems(page)) ?? [];
  let emptyDownloadsTitle = messages.activity.nothingDownloading;
  if (downloadFilter === "completed") {
    emptyDownloadsTitle = messages.activity.noCompletedDownloads;
  } else if (downloadFilter === "all") {
    emptyDownloadsTitle = messages.activity.noDownloadsYet;
  }

  useEffect(() => {
    const total = jobsQuery.data?.page.total;
    if (total === undefined) return;
    const lastOffset =
      total === 0 ? 0 : Math.floor((total - 1) / JOB_PAGE_SIZE) * JOB_PAGE_SIZE;
    if (jobOffset > lastOffset) setJobOffset(lastOffset);
  }, [jobOffset, jobsQuery.data?.page.total]);

  return (
    <Page
      eyebrow={messages.activity.eyebrow}
      title={messages.activity.title}
      description={messages.activity.description}
      actions={
        <Button type="button" onClick={() => setAddOpen(true)}>
          <Plus size={17} /> {messages.activity.addDownloadAction}
        </Button>
      }
      wide
    >
      <div className="activity-toolbar">
        <SegmentedControl
          label={messages.activity.view}
          value={tab}
          options={[
            {
              value: "downloads",
              label: messages.activity.downloadsWithCount({
                count: downloads.length,
              }),
            },
            { value: "jobs", label: messages.activity.jobs },
            { value: "history", label: messages.activity.history },
          ]}
          onChange={setTab}
        />
        <div className="activity-toolbar__actions">
          {tab === "downloads" ? (
            <DownloadFilterBar
              value={downloadFilter}
              onChange={setDownloadFilter}
            />
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void queryClient.invalidateQueries()}
          >
            <RefreshCw size={16} /> {messages.common.refresh}
          </Button>
        </div>
      </div>
      {tab === "downloads" ? (
        <>
          {downloadsQuery.isLoading ? (
            <InlineSpinner label={messages.activity.contactingTransmission} />
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
              title={emptyDownloadsTitle}
              description={
                downloadFilter === "completed"
                  ? messages.activity.finishedDownloads
                  : messages.activity.automaticDownloads
              }
              action={
                <Button type="button" onClick={() => setAddOpen(true)}>
                  <Plus size={16} /> {messages.activity.addDownloadAction}
                </Button>
              }
            />
          ) : null}
          <div className="download-list">
            {downloads.map((download) => (
              <DownloadCard
                key={download.id}
                download={download}
                canMutate={
                  sessionQuery.data?.user?.rank === "admin" ||
                  download.requestedByMe === true
                }
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
                {messages.activity.loadOlderDownloads}
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
          {canManageSettings ? (
            <ManualJobControls
              kind={manualJobKind}
              busy={createJobMutation.isPending}
              onChange={(kind) => {
                setManualJobKind(kind);
                createJobMutation.reset();
              }}
              onRun={() => createJobMutation.mutate(manualJobKind)}
            />
          ) : null}
          {createJobMutation.isSuccess ? (
            <div className="notice notice--success" role="status">
              <CheckCircle2 size={17} />{" "}
              {messages.activity.jobQueued({
                kind: formatJobKind(manualJobKind, messages),
              })}
            </div>
          ) : null}
          {createJobMutation.isError ? (
            <div className="notice notice--error" role="alert">
              {createJobMutation.error.message}
            </div>
          ) : null}
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
              onOpen={setSelectedJobId}
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
      <JobDetailsDialog
        job={jobDetailsQuery.data}
        loading={jobDetailsQuery.isLoading}
        error={jobDetailsQuery.error}
        onClose={() => setSelectedJobId(undefined)}
      />
      <Dialog
        open={Boolean(cancelTarget)}
        title={messages.activity.removeDownload}
        description={messages.activity.removeDownloadDescription}
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
              <strong>{messages.activity.alsoDeleteData}</strong>
              <small>{messages.activity.alsoDeleteDataHint}</small>
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
              {messages.activity.keepDownload}
            </Button>
            <Button
              type="button"
              variant="danger"
              busy={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              <Trash2 size={16} /> {messages.activity.remove}
            </Button>
          </div>
        </div>
      </Dialog>
    </Page>
  );
}
