import type { IntegrationKey } from "../../contracts/api-routes";
import type { AppSettings, IntegrationStatus } from "../types";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  AlertTriangle,
  CheckCircle2,
  Database,
  FolderCheck,
  HardDrive,
  KeyRound,
  LogOut,
  Network,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  UploadCloud,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";

import { api } from "../api/client";
import { normalizeSystemStatus } from "../api/normalize";
import { Page } from "../components/Page";
import { ReleaseTermFields } from "../components/ReleaseTermFields";
import {
  Badge,
  Button,
  Dialog,
  ErrorState,
  Field,
  InlineSpinner,
  SelectField,
  TextareaField,
} from "../components/ui";
import { formatBytes, formatDate } from "../lib/format";

const settingsSchema = z.object({
  language: z.string().min(2, "Enter an ISO language code."),
  region: z.string().length(2, "Use a two-letter region code."),
  tmdbApiKey: z.string(),
  omdbApiKey: z.string(),
  jackettUrl: z.string().url("Enter a valid Jackett URL."),
  jackettApiKey: z.string(),
  transmissionUrl: z.string().url("Enter a valid Transmission URL."),
  transmissionUsername: z.string(),
  transmissionPassword: z.string(),
  minimumSeeders: z.coerce.number().int().min(0),
  minimumSizeMb: z.union([z.literal(""), z.coerce.number().min(0)]),
  maximumSizeMb: z.union([z.literal(""), z.coerce.number().positive()]),
  requiredTerms: z.string(),
  preferredTerms: z.string(),
  rejectedTerms: z.string(),
  qualityOrder: z.string().min(1, "Add at least one quality."),
  downloadsPath: z.string().startsWith("/", "Use an absolute path."),
  moviesPath: z.string().startsWith("/", "Use an absolute path."),
  televisionPath: z.string().startsWith("/", "Use an absolute path."),
  organizationStrategy: z.enum(["hardlink", "symlink", "copy", "move"]),
  searchMissing: z.string().min(1),
  refreshMetadata: z.string().min(1),
  scanLibrary: z.string().min(1),
  backup: z.string().min(1),
  backupRetention: z.coerce.number().int().min(1).max(365),
});

type SettingsForm = z.input<typeof settingsSchema>;
type ParsedSettingsForm = z.output<typeof settingsSchema>;

const emptySettings: AppSettings = {
  locale: { language: "en", region: "US" },
  integrations: {
    jackettUrl: "http://jackett:9117",
    transmissionUrl: "http://transmission:9091/transmission/rpc",
  },
  acquisition: {
    minimumSeeders: 3,
    minimumSizeMb: null,
    maximumSizeMb: null,
    requiredTerms: [],
    preferredTerms: [],
    rejectedTerms: [],
    qualityOrder: ["2160p", "1080p", "720p"],
  },
  storage: {
    downloadsPath: "/media/downloads",
    moviesPath: "/media/movies",
    televisionPath: "/media/tv",
    organizationStrategy: "hardlink",
  },
  schedules: {
    searchMissing: "0 */6 * * *",
    refreshMetadata: "0 3 * * *",
    scanLibrary: "0 4 * * *",
    backup: "0 2 * * *",
    backupRetention: 14,
  },
};

function toForm(settings: AppSettings): SettingsForm {
  return {
    language: settings.locale.language,
    region: settings.locale.region,
    tmdbApiKey: settings.integrations.tmdbApiKey ?? "",
    omdbApiKey: settings.integrations.omdbApiKey ?? "",
    jackettUrl: settings.integrations.jackettUrl,
    jackettApiKey: settings.integrations.jackettApiKey ?? "",
    transmissionUrl: settings.integrations.transmissionUrl,
    transmissionUsername: settings.integrations.transmissionUsername ?? "",
    transmissionPassword: settings.integrations.transmissionPassword ?? "",
    minimumSeeders: settings.acquisition.minimumSeeders,
    minimumSizeMb: settings.acquisition.minimumSizeMb ?? "",
    maximumSizeMb: settings.acquisition.maximumSizeMb ?? "",
    requiredTerms: settings.acquisition.requiredTerms.join(", "),
    preferredTerms: settings.acquisition.preferredTerms.join(", "),
    rejectedTerms: settings.acquisition.rejectedTerms.join(", "),
    qualityOrder: settings.acquisition.qualityOrder.join(", "),
    downloadsPath: settings.storage.downloadsPath,
    moviesPath: settings.storage.moviesPath,
    televisionPath: settings.storage.televisionPath,
    organizationStrategy: settings.storage.organizationStrategy,
    searchMissing: settings.schedules.searchMissing,
    refreshMetadata: settings.schedules.refreshMetadata,
    scanLibrary: settings.schedules.scanLibrary,
    backup: settings.schedules.backup,
    backupRetention: settings.schedules.backupRetention,
  };
}

function terms(value: string): string[] {
  return value
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
}

function fromForm(value: ParsedSettingsForm): AppSettings {
  return {
    locale: { language: value.language, region: value.region.toUpperCase() },
    integrations: {
      tmdbApiKey: value.tmdbApiKey || undefined,
      omdbApiKey: value.omdbApiKey || undefined,
      jackettUrl: value.jackettUrl,
      jackettApiKey: value.jackettApiKey || undefined,
      transmissionUrl: value.transmissionUrl,
      transmissionUsername: value.transmissionUsername || undefined,
      transmissionPassword: value.transmissionPassword || undefined,
    },
    acquisition: {
      minimumSeeders: value.minimumSeeders,
      minimumSizeMb: value.minimumSizeMb === "" ? null : value.minimumSizeMb,
      maximumSizeMb: value.maximumSizeMb === "" ? null : value.maximumSizeMb,
      requiredTerms: terms(value.requiredTerms),
      preferredTerms: terms(value.preferredTerms),
      rejectedTerms: terms(value.rejectedTerms),
      qualityOrder: terms(value.qualityOrder),
    },
    storage: {
      downloadsPath: value.downloadsPath,
      moviesPath: value.moviesPath,
      televisionPath: value.televisionPath,
      organizationStrategy: value.organizationStrategy,
    },
    schedules: {
      searchMissing: value.searchMissing,
      refreshMetadata: value.refreshMetadata,
      scanLibrary: value.scanLibrary,
      backup: value.backup,
      backupRetention: value.backupRetention,
    },
  };
}

function ConnectionCard({
  integration,
  testing,
  onTest,
}: {
  integration?: IntegrationStatus;
  testing: boolean;
  onTest: () => void;
}) {
  let statusTone = "neutral";
  if (integration?.healthy) statusTone = "success";
  else if (integration?.configured) statusTone = "warning";
  const statusMessage =
    integration?.message ??
    (integration?.configured ? "Configured" : "Not configured");
  return (
    <article className="connection-card">
      <div className="connection-card__status">
        <span className={`status-dot status-dot--${statusTone}`} />
        <div>
          <strong>{integration?.label ?? "Integration"}</strong>
          <small>{statusMessage}</small>
        </div>
      </div>
      <div className="connection-card__action">
        {integration?.version ? <Badge>{integration.version}</Badge> : null}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          busy={testing}
          onClick={onTest}
        >
          Test
        </Button>
      </div>
    </article>
  );
}

const connectionDefinitions: Array<[IntegrationKey, string]> = [
  ["tmdb", "TMDB"],
  ["jackett", "Jackett"],
  ["transmission", "Transmission"],
  ["omdb", "OMDb"],
];

export function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const [restoreFile, setRestoreFile] = useState<File>();
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: ({ signal }) => api.get("getSettings", { signal }),
  });
  const statusQuery = useQuery({
    queryKey: ["system", "status"],
    queryFn: async ({ signal }) =>
      normalizeSystemStatus(await api.get("systemStatus", { signal })),
  });
  const backupsQuery = useQuery({
    queryKey: ["system", "backups"],
    queryFn: ({ signal }) => api.get("listBackups", { signal }),
  });
  const {
    register,
    handleSubmit,
    reset,
    getValues,
    setError,
    clearErrors,
    formState: { errors, isDirty },
  } = useForm<SettingsForm>({ defaultValues: toForm(emptySettings) });

  useEffect(() => {
    if (settingsQuery.data) reset(toForm(settingsQuery.data));
  }, [reset, settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (value: ParsedSettingsForm) =>
      api.patch("updateSettings", { body: fromForm(value) }),
    onSuccess: (settings) => {
      reset(toForm(settings));
      setNotice("Settings saved securely.");
      void queryClient.invalidateQueries({ queryKey: ["system"] });
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
    },
  });
  const testMutation = useMutation({
    mutationFn: (key: IntegrationKey) =>
      api.post("testIntegration", { params: { key } }),
    onSuccess: (result) => {
      setNotice(
        `${result.label} connection ${result.healthy ? "is ready" : "needs attention"}.`,
      );
      void statusQuery.refetch();
    },
  });
  const validateStorageMutation = useMutation({
    mutationFn: () => {
      const current = settingsSchema.parse(getValues());
      return api.post("validateStorage", {
        body: fromForm(current).storage,
      });
    },
    onSuccess: (result) =>
      setNotice(
        result.message ??
          (result.valid
            ? "Storage paths are accessible."
            : "Storage validation failed."),
      ),
  });
  const backupMutation = useMutation({
    mutationFn: () => api.post("createBackup"),
    onSuccess: () => {
      setNotice("Backup created and verified.");
      void backupsQuery.refetch();
    },
  });
  const restoreMutation = useMutation({
    mutationFn: (file: File) =>
      api.post("stageRestore", {
        body: file,
        headers: { "x-bobarr-restore-confirmation": "stage-restore" },
      }),
    onSuccess: () => {
      setNotice(
        "Restore staged. Restart Bobarr to apply it; a rollback backup will be created first.",
      );
      setRestoreDialogOpen(false);
      setRestoreConfirmation("");
      setRestoreFile(undefined);
      void backupsQuery.refetch();
    },
  });
  const logoutMutation = useMutation({
    mutationFn: () => api.post("logout"),
    onSuccess: () => {
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });

  const integration = (key: IntegrationKey) =>
    statusQuery.data?.integrations.find((item) => item.key === key);
  const fieldError = (key: keyof SettingsForm) =>
    errors[key]?.message?.toString();
  const submitSettings = (value: SettingsForm) => {
    clearErrors();
    const parsed = settingsSchema.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && field in value) {
          setError(field as keyof SettingsForm, { message: issue.message });
        }
      }
      return;
    }
    saveMutation.mutate(parsed.data);
  };
  let backupListContent = (
    <p className="settings-muted">No verified backups yet.</p>
  );
  if (backupsQuery.isLoading) {
    backupListContent = <InlineSpinner label="Checking backups…" />;
  } else if (backupsQuery.isError) {
    backupListContent = (
      <p className="field__error">{backupsQuery.error.message}</p>
    );
  } else if (backupsQuery.data?.backups.length) {
    backupListContent = (
      <ul className="backup-list">
        {backupsQuery.data.backups.map((backup) => (
          <li key={backup.sha256}>
            <span>
              <strong>{formatDate(backup.createdAt)}</strong>
              <small>
                Schema {backup.migrationVersion} · {backup.name}
              </small>
            </span>
            <Badge>{formatBytes(backup.sizeBytes)}</Badge>
          </li>
        ))}
      </ul>
    );
  }

  if (settingsQuery.isLoading)
    return (
      <Page title="Settings">
        <InlineSpinner label="Loading settings…" />
      </Page>
    );
  if (settingsQuery.isError)
    return (
      <Page title="Settings">
        <ErrorState
          error={settingsQuery.error}
          onRetry={() => void settingsQuery.refetch()}
        />
      </Page>
    );

  return (
    <Page
      eyebrow="Configuration"
      title="Settings"
      description="Connections, acquisition preferences, storage, and maintenance."
      wide
    >
      <form className="settings-layout" onSubmit={handleSubmit(submitSettings)}>
        <nav className="settings-nav" aria-label="Settings sections">
          <a href="#connections">
            <Network size={16} /> Connections
          </a>
          <a href="#preferences">
            <SlidersHorizontal size={16} /> Preferences
          </a>
          <a href="#storage">
            <HardDrive size={16} /> Storage
          </a>
          <a href="#schedules">
            <RefreshCw size={16} /> Schedules
          </a>
          <a href="#maintenance">
            <Database size={16} /> Maintenance
          </a>
        </nav>

        <div className="settings-content">
          {notice ? (
            <div className="notice notice--success" role="status">
              <CheckCircle2 size={17} />
              {notice}
            </div>
          ) : null}
          {saveMutation.isError ? (
            <div className="notice notice--error" role="alert">
              {saveMutation.error.message}
            </div>
          ) : null}

          <section className="settings-section" id="connections">
            <header>
              <span className="settings-section__icon">
                <Network size={20} />
              </span>
              <div>
                <h2>Connections</h2>
                <p>
                  Credentials are encrypted at rest and are never returned in
                  full.
                </p>
              </div>
            </header>
            <div className="connection-grid">
              {connectionDefinitions.map(([key, label]) => (
                <ConnectionCard
                  key={key}
                  integration={
                    integration(key) ?? {
                      key,
                      label,
                      configured: false,
                      healthy: false,
                    }
                  }
                  testing={
                    testMutation.isPending && testMutation.variables === key
                  }
                  onTest={() => testMutation.mutate(key)}
                />
              ))}
            </div>
            <div className="form-grid">
              <Field
                label="TMDB API key"
                type="password"
                autoComplete="off"
                placeholder="Leave unchanged to keep current secret"
                error={fieldError("tmdbApiKey")}
                {...register("tmdbApiKey")}
              />
              <Field
                label="OMDb API key"
                type="password"
                autoComplete="off"
                placeholder="Optional"
                error={fieldError("omdbApiKey")}
                {...register("omdbApiKey")}
              />
              <Field
                label="Jackett URL"
                type="url"
                hint="Use the Jackett instance URL; reverse-proxy, dashboard, and copied Torznab URLs are normalized safely."
                error={fieldError("jackettUrl")}
                {...register("jackettUrl")}
              />
              <Field
                label="Jackett API key"
                type="password"
                autoComplete="off"
                placeholder="Leave unchanged to keep current secret"
                error={fieldError("jackettApiKey")}
                {...register("jackettApiKey")}
              />
              <Field
                label="Transmission RPC URL"
                type="url"
                error={fieldError("transmissionUrl")}
                {...register("transmissionUrl")}
              />
              <Field
                label="Transmission username"
                autoComplete="off"
                error={fieldError("transmissionUsername")}
                {...register("transmissionUsername")}
              />
              <Field
                label="Transmission password"
                type="password"
                autoComplete="new-password"
                placeholder="Leave unchanged to keep current secret"
                error={fieldError("transmissionPassword")}
                {...register("transmissionPassword")}
              />
            </div>
          </section>

          <section className="settings-section" id="preferences">
            <header>
              <span className="settings-section__icon">
                <SlidersHorizontal size={20} />
              </span>
              <div>
                <h2>Acquisition preferences</h2>
                <p>
                  Hard limits exclude releases; term and quality rules determine
                  ranking.
                </p>
              </div>
            </header>
            <div className="form-grid form-grid--three">
              <Field
                label="Minimum seeders"
                type="number"
                min={0}
                error={fieldError("minimumSeeders")}
                {...register("minimumSeeders")}
              />
              <Field
                label="Minimum size (MB)"
                type="number"
                min={0}
                placeholder="No minimum"
                error={fieldError("minimumSizeMb")}
                {...register("minimumSizeMb")}
              />
              <Field
                label="Maximum size (MB)"
                type="number"
                min={1}
                placeholder="No maximum"
                error={fieldError("maximumSizeMb")}
                {...register("maximumSizeMb")}
              />
              <Field
                label="Metadata language"
                hint="ISO 639-1 code"
                error={fieldError("language")}
                {...register("language")}
              />
              <Field
                label="Region"
                hint="Two-letter country code"
                maxLength={2}
                error={fieldError("region")}
                {...register("region")}
              />
            </div>
            <TextareaField
              label="Quality order"
              rows={2}
              hint="Highest priority first, separated by commas."
              error={fieldError("qualityOrder")}
              {...register("qualityOrder")}
            />
            <ReleaseTermFields
              required={{
                input: register("requiredTerms"),
                error: fieldError("requiredTerms"),
              }}
              preferred={{
                input: register("preferredTerms"),
                error: fieldError("preferredTerms"),
              }}
              rejected={{
                input: register("rejectedTerms"),
                error: fieldError("rejectedTerms"),
              }}
            />
          </section>

          <section className="settings-section" id="storage">
            <header>
              <span className="settings-section__icon">
                <HardDrive size={20} />
              </span>
              <div>
                <h2>Storage & organization</h2>
                <p>All paths must live under the mounted media root.</p>
              </div>
            </header>
            <div className="form-grid">
              <Field
                label="Downloads path"
                error={fieldError("downloadsPath")}
                {...register("downloadsPath")}
              />
              <Field
                label="Movies path"
                error={fieldError("moviesPath")}
                {...register("moviesPath")}
              />
              <Field
                label="Television path"
                error={fieldError("televisionPath")}
                {...register("televisionPath")}
              />
              <SelectField
                label="Organization strategy"
                hint="Hardlinks preserve seeding without duplicating data."
                error={fieldError("organizationStrategy")}
                {...register("organizationStrategy")}
              >
                <option value="hardlink">Hardlink (recommended)</option>
                <option value="symlink">Symbolic link</option>
                <option value="copy">Copy</option>
                <option value="move">Move</option>
              </SelectField>
            </div>
            <Button
              type="button"
              variant="secondary"
              busy={validateStorageMutation.isPending}
              onClick={() => validateStorageMutation.mutate()}
            >
              <FolderCheck size={17} /> Validate paths
            </Button>
          </section>

          <section className="settings-section" id="schedules">
            <header>
              <span className="settings-section__icon">
                <RefreshCw size={20} />
              </span>
              <div>
                <h2>Schedules</h2>
                <p>Standard five-field cron expressions evaluated in UTC.</p>
              </div>
            </header>
            <div className="form-grid">
              <Field
                label="Search missing media"
                error={fieldError("searchMissing")}
                {...register("searchMissing")}
              />
              <Field
                label="Refresh metadata"
                error={fieldError("refreshMetadata")}
                {...register("refreshMetadata")}
              />
              <Field
                label="Scan library"
                error={fieldError("scanLibrary")}
                {...register("scanLibrary")}
              />
              <Field
                label="Create backup"
                error={fieldError("backup")}
                {...register("backup")}
              />
              <Field
                label="Backups to retain"
                type="number"
                min={1}
                max={365}
                error={fieldError("backupRetention")}
                {...register("backupRetention")}
              />
            </div>
          </section>

          <section className="settings-section" id="maintenance">
            <header>
              <span className="settings-section__icon">
                <Database size={20} />
              </span>
              <div>
                <h2>Maintenance</h2>
                <p>
                  Back up application state before upgrades or storage changes.
                </p>
              </div>
            </header>
            <div className="maintenance-actions">
              <div>
                <Archive size={20} />
                <span>
                  <strong>Create a backup now</strong>
                  <small>
                    A consistent SQLite snapshot is retained in your config
                    volume.
                  </small>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  busy={backupMutation.isPending}
                  onClick={() => backupMutation.mutate()}
                >
                  Back up
                </Button>
              </div>
              <div>
                <UploadCloud size={20} />
                <span>
                  <strong>Stage a database restore</strong>
                  <small>
                    The upload is verified now and applied only after a Bobarr
                    restart.
                  </small>
                </span>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() =>
                    document
                      .querySelector<HTMLInputElement>("#restore-backup-file")
                      ?.click()
                  }
                >
                  Choose file
                </Button>
                <input
                  id="restore-backup-file"
                  className="sr-only"
                  type="file"
                  accept=".sqlite,application/vnd.sqlite3,application/octet-stream"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (!file) return;
                    setRestoreFile(file);
                    setRestoreConfirmation("");
                    setRestoreDialogOpen(true);
                  }}
                />
              </div>
              <div>
                <ShieldCheck size={20} />
                <span>
                  <strong>Administrator session</strong>
                  <small>
                    Sign out this browser without interrupting background work.
                  </small>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  busy={logoutMutation.isPending}
                  onClick={() => logoutMutation.mutate()}
                >
                  <LogOut size={16} /> Sign out
                </Button>
              </div>
              <div>
                <KeyRound size={20} />
                <span>
                  <strong>Offline password reset</strong>
                  <small>
                    Use the documented CLI command on the Bobarr host.
                  </small>
                </span>
                <Badge>Host only</Badge>
              </div>
            </div>
            <div className="backup-status" aria-live="polite">
              {backupsQuery.data?.stagedRestore ? (
                <div className="notice notice--error">
                  <AlertTriangle size={17} />A restore is staged for the next
                  restart. Its verified image is{" "}
                  {formatBytes(backupsQuery.data.stagedRestore.sizeBytes)}.
                </div>
              ) : null}
              <h3>Verified application backups</h3>
              {backupListContent}
            </div>
          </section>

          <div className="settings-savebar">
            <span>
              {isDirty
                ? "You have unsaved changes."
                : "Settings are up to date."}
            </span>
            <Button
              type="submit"
              busy={saveMutation.isPending}
              disabled={!isDirty}
            >
              <Save size={17} /> Save settings
            </Button>
          </div>
        </div>
      </form>
      <Dialog
        open={restoreDialogOpen}
        onClose={() => {
          if (restoreMutation.isPending) return;
          setRestoreDialogOpen(false);
          setRestoreConfirmation("");
          setRestoreFile(undefined);
        }}
        title="Stage database restore"
        description="This changes application state on the next restart."
        size="sm"
      >
        <div className="stack">
          <div className="notice notice--error" role="alert">
            <AlertTriangle size={18} />
            Downloads, library records, settings, administrator sessions, and
            encrypted secrets will return to the backup state. Keep the same
            master key or connector secrets cannot be decrypted.
          </div>
          <p className="settings-muted">
            Selected: <strong>{restoreFile?.name}</strong> (
            {formatBytes(restoreFile?.size)})
          </p>
          <Field
            label='Type "RESTORE" to confirm'
            autoComplete="off"
            value={restoreConfirmation}
            onChange={(event) => setRestoreConfirmation(event.target.value)}
          />
          {restoreMutation.isError ? (
            <p className="field__error" role="alert">
              {restoreMutation.error.message}
            </p>
          ) : null}
          <div className="dialog-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={restoreMutation.isPending}
              onClick={() => {
                setRestoreDialogOpen(false);
                setRestoreFile(undefined);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              busy={restoreMutation.isPending}
              disabled={restoreConfirmation !== "RESTORE" || !restoreFile}
              onClick={() => {
                if (restoreFile) restoreMutation.mutate(restoreFile);
              }}
            >
              Verify and stage restore
            </Button>
          </div>
        </div>
      </Dialog>
    </Page>
  );
}
