import type { IntegrationKey } from "../../contracts/api-routes";
import type { IntegrationStatus } from "../types";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  AlertTriangle,
  CheckCircle2,
  Database,
  HardDrive,
  KeyRound,
  LogOut,
  Network,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  UploadCloud,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useNavigate } from "react-router";

import { PeopleSection } from "./PeopleSection";
import {
  emptySettings,
  fromForm,
  settingsSchema,
  toForm,
  type ParsedSettingsForm,
  type SettingsForm,
} from "./settings-form";
import { StorageSection, type VolumeHealth } from "./StorageSection";
import { api } from "../api/client";
import { collectionItems, normalizeSystemStatus } from "../api/normalize";
import { Page } from "../components/Page";
import { ReleaseTermFields } from "../components/ReleaseTermFields";
import {
  Badge,
  Button,
  Dialog,
  ErrorState,
  Field,
  InlineSpinner,
  TextareaField,
} from "../components/ui";
import { useUi } from "../i18n/ui";
import { formatBytes, formatDate } from "../lib/format";

function ConnectionCard({
  integration,
  testing,
  disabled,
  onTest,
}: {
  integration?: IntegrationStatus;
  testing: boolean;
  disabled: boolean;
  onTest: () => void;
}) {
  const { messages } = useUi();
  let statusTone = "neutral";
  if (integration?.healthy) statusTone = "success";
  else if (integration?.configured) statusTone = "warning";
  const statusMessage =
    integration?.message ??
    (integration?.configured
      ? messages.common.configured
      : messages.common.notConfigured);
  return (
    <article className="connection-card">
      <div className="connection-card__status">
        <span className={`status-dot status-dot--${statusTone}`} />
        <div>
          <strong>{integration?.label ?? messages.common.integration}</strong>
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
          disabled={disabled}
          title={disabled ? messages.settings.testSaveFirst : undefined}
          onClick={onTest}
        >
          {messages.common.test}
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
  const { messages, locale } = useUi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  }>();
  const showSuccess = (text: string) => setNotice({ tone: "success", text });
  const showError = (error: Error) =>
    setNotice({ tone: "error", text: error.message });
  const [volumeStats, setVolumeStats] = useState<VolumeHealth[]>();
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
  const organizationQuery = useQuery({
    queryKey: ["jobs", "storage-organization"],
    queryFn: ({ signal }) =>
      api.get("listJobs", {
        query: { kind: "library.organize.v1", limit: 1, offset: 0 },
        signal,
      }),
    refetchInterval: 3_000,
  });
  const organizationJob = collectionItems(organizationQuery.data)[0];
  const {
    register,
    control,
    handleSubmit,
    reset,
    getValues,
    setError,
    clearErrors,
    formState: { errors, isDirty },
  } = useForm<SettingsForm>({ defaultValues: toForm(emptySettings) });
  const volumeFields = useFieldArray({
    control,
    name: "volumes",
    keyName: "fieldKey",
  });
  const assignIssue = (issue: {
    path: readonly PropertyKey[];
    message: string;
  }) => {
    const [head, index, key] = issue.path;
    if (
      head === "volumes" &&
      typeof index === "number" &&
      (key === "label" ||
        key === "downloadsPath" ||
        key === "moviesPath" ||
        key === "televisionPath")
    ) {
      setError(`volumes.${index}.${key}`, { message: issue.message });
      return;
    }
    if (typeof head === "string") {
      setError(head as keyof SettingsForm, { message: issue.message });
    }
  };

  useEffect(() => {
    if (settingsQuery.data) reset(toForm(settingsQuery.data));
  }, [reset, settingsQuery.data]);

  useEffect(() => {
    if (isDirty) setNotice(undefined);
  }, [isDirty]);

  const saveMutation = useMutation({
    mutationFn: (value: ParsedSettingsForm) =>
      api.patch("updateSettings", { body: fromForm(value) }),
    onSuccess: (settings) => {
      queryClient.setQueryData(["settings"], settings);
      reset(toForm(settings));
      showSuccess(messages.settings.savedSecurely);
      void queryClient.invalidateQueries({ queryKey: ["system"] });
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
    },
    onError: showError,
  });
  const testMutation = useMutation({
    mutationFn: (key: IntegrationKey) =>
      api.post("testIntegration", { params: { key } }),
    onSuccess: (result) => {
      setNotice({
        tone: result.healthy ? "success" : "error",
        text: messages.settings.connectionResult({
          label: result.label,
          healthy: result.healthy,
        }),
      });
      void statusQuery.refetch();
    },
    onError: showError,
  });
  const validateStorageMutation = useMutation({
    mutationFn: () => {
      clearErrors("volumes");
      const parsed = settingsSchema(messages).safeParse(getValues());
      if (!parsed.success) {
        for (const issue of parsed.error.issues) assignIssue(issue);
        throw new Error(messages.settings.storageValidationFailed);
      }
      return api.post("validateStorage", {
        body: fromForm(parsed.data).storage,
      });
    },
    onSuccess: (result) => {
      setVolumeStats(result.volumes);
      setNotice({
        tone: result.valid ? "success" : "error",
        text:
          result.message ||
          (result.valid
            ? messages.settings.storageAccessible
            : messages.settings.storageValidationFailed),
      });
    },
    onError: showError,
  });
  const backupMutation = useMutation({
    mutationFn: () => api.post("createBackup"),
    onSuccess: () => {
      showSuccess(messages.settings.backupCreated);
      void backupsQuery.refetch();
    },
    onError: showError,
  });
  const organizeStorageMutation = useMutation({
    mutationFn: () => api.post("organizeStorage"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
  const restoreMutation = useMutation({
    mutationFn: (file: File) =>
      api.post("stageRestore", {
        body: file,
        headers: { "x-bobarr-restore-confirmation": "stage-restore" },
      }),
    onSuccess: () => {
      showSuccess(messages.settings.restoreStaged);
      closeRestoreDialog();
      void backupsQuery.refetch();
    },
  });
  // Each restore attempt starts clean: no old file, confirmation or error.
  function closeRestoreDialog() {
    setRestoreDialogOpen(false);
    setRestoreConfirmation("");
    setRestoreFile(undefined);
    restoreMutation.reset();
  }
  const logoutMutation = useMutation({
    mutationFn: () => api.post("logout"),
    onSuccess: () => {
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });
  const resetLoginLockMutation = useMutation({
    mutationFn: () => api.post("resetLoginLock"),
    onSuccess: () => showSuccess(messages.settings.loginLockReset),
    onError: showError,
  });

  const integration = (key: IntegrationKey) =>
    statusQuery.data?.integrations.find((item) => item.key === key);
  const fieldError = (key: keyof SettingsForm) =>
    errors[key]?.message?.toString();
  const volumeFieldError = (
    index: number,
    key: "label" | "downloadsPath" | "moviesPath" | "televisionPath",
  ) => errors.volumes?.[index]?.[key]?.message?.toString();
  const submitSettings = (value: SettingsForm) => {
    clearErrors();
    const parsed = settingsSchema(messages).safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) assignIssue(issue);
      return;
    }
    saveMutation.mutate(parsed.data);
  };
  let backupListContent = (
    <p className="settings-muted">{messages.settings.noVerifiedBackups}</p>
  );
  if (backupsQuery.isLoading) {
    backupListContent = (
      <InlineSpinner label={messages.settings.checkingBackups} />
    );
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
              <strong>
                {formatDate(backup.createdAt, locale) ?? messages.dates.unknown}
              </strong>
              <small>
                {messages.settings.schemaVersion({
                  version: backup.migrationVersion,
                  name: backup.name,
                })}
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
      <Page title={messages.settings.title}>
        <InlineSpinner label={messages.settings.loading} />
      </Page>
    );
  if (settingsQuery.isError)
    return (
      <Page title={messages.settings.title}>
        <ErrorState
          error={settingsQuery.error}
          onRetry={() => void settingsQuery.refetch()}
        />
      </Page>
    );

  return (
    <Page
      eyebrow={messages.settings.eyebrow}
      title={messages.settings.title}
      description={messages.settings.description}
      wide
    >
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={messages.settings.sections}>
          <a href="#connections">
            <Network size={16} /> {messages.settings.connections}
          </a>
          <a href="#preferences">
            <SlidersHorizontal size={16} /> {messages.settings.preferences}
          </a>
          <a href="#storage">
            <HardDrive size={16} /> {messages.settings.storage}
          </a>
          <a href="#schedules">
            <RefreshCw size={16} /> {messages.settings.schedules}
          </a>
          <a href="#maintenance">
            <Database size={16} /> {messages.settings.maintenance}
          </a>
          <a href="#security">
            <ShieldCheck size={16} /> {messages.settings.security}
          </a>
          <a href="#people">
            <Users size={16} /> {messages.settings.people}
          </a>
        </nav>

        <div className="settings-content">
          <section className="settings-section" id="connections">
            <header>
              <span className="settings-section__icon">
                <Network size={20} />
              </span>
              <div>
                <h2>{messages.settings.connections}</h2>
                <p>{messages.settings.connectionsBody}</p>
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
                  disabled={isDirty}
                  onTest={() => testMutation.mutate(key)}
                />
              ))}
            </div>
            <div className="form-grid">
              <Field
                label={messages.settings.tmdbApiKey}
                type="password"
                autoComplete="off"
                placeholder={messages.settings.keepSecret}
                error={fieldError("tmdbApiKey")}
                {...register("tmdbApiKey")}
              />
              <Field
                label={messages.settings.omdbApiKey}
                type="password"
                autoComplete="off"
                placeholder={messages.common.optional}
                error={fieldError("omdbApiKey")}
                {...register("omdbApiKey")}
              />
              <Field
                label={messages.settings.jackettUrl}
                type="url"
                hint={messages.settings.jackettUrlHint}
                error={fieldError("jackettUrl")}
                {...register("jackettUrl")}
              />
              <Field
                label={messages.settings.jackettApiKey}
                type="password"
                autoComplete="off"
                placeholder={messages.settings.keepSecret}
                error={fieldError("jackettApiKey")}
                {...register("jackettApiKey")}
              />
              <Field
                label={messages.settings.transmissionRpcUrl}
                type="url"
                error={fieldError("transmissionUrl")}
                {...register("transmissionUrl")}
              />
              <Field
                label={messages.settings.transmissionUsername}
                autoComplete="off"
                error={fieldError("transmissionUsername")}
                {...register("transmissionUsername")}
              />
              <Field
                label={messages.settings.transmissionPassword}
                type="password"
                autoComplete="new-password"
                placeholder={messages.settings.keepSecret}
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
                <h2>{messages.settings.preferencesTitle}</h2>
                <p>{messages.settings.preferencesBody}</p>
              </div>
            </header>
            <div className="form-grid form-grid--three">
              <Field
                label={messages.settings.minimumSeeders}
                type="number"
                min={0}
                error={fieldError("minimumSeeders")}
                {...register("minimumSeeders")}
              />
              <Field
                label={messages.settings.minimumSizeMb}
                type="number"
                min={0}
                placeholder={messages.settings.noMinimum}
                error={fieldError("minimumSizeMb")}
                {...register("minimumSizeMb")}
              />
              <Field
                label={messages.settings.maximumSizeMb}
                type="number"
                min={1}
                placeholder={messages.settings.noMaximum}
                error={fieldError("maximumSizeMb")}
                {...register("maximumSizeMb")}
              />
              <Field
                label={messages.settings.metadataLanguage}
                hint={messages.settings.metadataLanguageHint}
                error={fieldError("language")}
                {...register("language")}
              />
              <Field
                label={messages.settings.region}
                hint={messages.settings.regionHint}
                maxLength={2}
                error={fieldError("region")}
                {...register("region")}
              />
            </div>
            <TextareaField
              label={messages.settings.qualityOrder}
              rows={2}
              hint={messages.settings.qualityOrderHint}
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

          <StorageSection
            register={register}
            volumeFields={volumeFields}
            getValues={getValues}
            volumeStats={volumeStats}
            volumeFieldError={volumeFieldError}
            organizationError={fieldError("organizationStrategy")}
            validateBusy={validateStorageMutation.isPending}
            onValidate={() => validateStorageMutation.mutate()}
            organizeBusy={organizeStorageMutation.isPending}
            organizeDisabled={isDirty || saveMutation.isPending}
            organizeError={organizeStorageMutation.error?.message}
            organizationJob={organizationJob}
            onOrganize={() => organizeStorageMutation.mutate()}
            messages={messages}
          />

          <section className="settings-section" id="schedules">
            <header>
              <span className="settings-section__icon">
                <RefreshCw size={20} />
              </span>
              <div>
                <h2>{messages.settings.schedules}</h2>
                <p>{messages.settings.schedulesBody}</p>
              </div>
            </header>
            <div className="form-grid">
              <Field
                label={messages.settings.searchMissing}
                error={fieldError("searchMissing")}
                {...register("searchMissing")}
              />
              <Field
                label={messages.settings.refreshMetadata}
                error={fieldError("refreshMetadata")}
                {...register("refreshMetadata")}
              />
              <Field
                label={messages.settings.scanLibrary}
                error={fieldError("scanLibrary")}
                {...register("scanLibrary")}
              />
              <Field
                label={messages.settings.createBackup}
                error={fieldError("backup")}
                {...register("backup")}
              />
              <Field
                label={messages.settings.backupsToRetain}
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
                <h2>{messages.settings.maintenance}</h2>
                <p>{messages.settings.maintenanceBody}</p>
              </div>
            </header>
            <div className="maintenance-actions">
              <div>
                <Archive size={20} />
                <span>
                  <strong>{messages.settings.createBackupNow}</strong>
                  <small>{messages.settings.createBackupHint}</small>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  busy={backupMutation.isPending}
                  onClick={() => backupMutation.mutate()}
                >
                  {messages.settings.backUp}
                </Button>
              </div>
              <div>
                <UploadCloud size={20} />
                <span>
                  <strong>{messages.settings.stageRestore}</strong>
                  <small>{messages.settings.stageRestoreHint}</small>
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
                  {messages.common.chooseFile}
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
                <KeyRound size={20} />
                <span>
                  <strong>{messages.settings.offlinePasswordReset}</strong>
                  <small>{messages.settings.offlinePasswordResetHint}</small>
                </span>
                <Badge>{messages.settings.hostOnly}</Badge>
              </div>
            </div>
            <div className="backup-status" aria-live="polite">
              {backupsQuery.data?.stagedRestore ? (
                <div className="notice notice--error">
                  <AlertTriangle size={17} />
                  {messages.settings.stagedRestore({
                    size: formatBytes(
                      backupsQuery.data.stagedRestore.sizeBytes,
                    ),
                  })}
                </div>
              ) : null}
              <h3>{messages.settings.verifiedBackups}</h3>
              {backupListContent}
            </div>
          </section>

          <section className="settings-section" id="security">
            <header>
              <span className="settings-section__icon">
                <ShieldCheck size={20} />
              </span>
              <div>
                <h2>{messages.settings.securityTitle}</h2>
                <p>{messages.settings.securityBody}</p>
              </div>
            </header>
            <div className="maintenance-actions">
              <label className="security-setting">
                <input type="checkbox" {...register("loginLockEnabled")} />
                <span>
                  <strong>{messages.settings.temporarilyLock}</strong>
                  <small>{messages.settings.temporarilyLockHint}</small>
                </span>
              </label>
              <div>
                <RotateCcw size={20} />
                <span>
                  <strong>{messages.settings.resetSignInLock}</strong>
                  <small>{messages.settings.resetSignInLockHint}</small>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  busy={resetLoginLockMutation.isPending}
                  onClick={() => resetLoginLockMutation.mutate()}
                >
                  {messages.discover.reset}
                </Button>
              </div>
              <div>
                <ShieldCheck size={20} />
                <span>
                  <strong>{messages.settings.thisSession}</strong>
                  <small>{messages.settings.thisSessionHint}</small>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  busy={logoutMutation.isPending}
                  onClick={() => logoutMutation.mutate()}
                >
                  <LogOut size={16} /> {messages.nav.signOut}
                </Button>
              </div>
            </div>
          </section>

          <PeopleSection onNotice={showSuccess} onError={showError} />

          <div className="settings-savebar">
            {notice ? (
              <span
                className={`settings-savebar__notice settings-savebar__notice--${notice.tone}`}
                role={notice.tone === "error" ? "alert" : "status"}
              >
                {notice.tone === "error" ? (
                  <AlertTriangle size={16} />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                {notice.text}
              </span>
            ) : (
              <span>
                {isDirty
                  ? messages.settings.unsavedChanges
                  : messages.settings.settingsUpToDate}
              </span>
            )}
            <Button
              type="button"
              busy={saveMutation.isPending}
              disabled={!isDirty}
              onClick={handleSubmit(submitSettings)}
            >
              <Save size={17} /> {messages.settings.saveSettings}
            </Button>
          </div>
        </div>
      </div>
      <Dialog
        open={restoreDialogOpen}
        onClose={() => {
          if (!restoreMutation.isPending) closeRestoreDialog();
        }}
        title={messages.settings.stageRestoreTitle}
        description={messages.settings.stageRestoreDescription}
        size="sm"
      >
        <div className="stack">
          <div className="notice notice--error" role="alert">
            <AlertTriangle size={18} />
            {messages.settings.restoreWarning}
          </div>
          <p className="settings-muted">
            {messages.settings.selectedFile({
              name: restoreFile?.name ?? "",
              size: formatBytes(restoreFile?.size),
            })}
          </p>
          <Field
            label={messages.settings.typeRestoreToConfirm}
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
              onClick={closeRestoreDialog}
            >
              {messages.common.cancel}
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
              {messages.settings.verifyAndStage}
            </Button>
          </div>
        </div>
      </Dialog>
    </Page>
  );
}
