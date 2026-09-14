import type { Messages } from "../i18n/en";
import type { Job } from "../types";
import type { SettingsForm } from "./settings-form";
import type {
  UseFieldArrayReturn,
  UseFormGetValues,
  UseFormRegister,
} from "react-hook-form";

import { FolderCheck, HardDrive, Plus, RefreshCw } from "lucide-react";
import { Link } from "react-router";

import { Button, Field, SelectField } from "../components/ui";
import { formatBytes } from "../lib/format";

export type VolumeHealth = {
  id: string;
  label: string;
  freeBytes: number | null;
  ok: boolean;
  message?: string;
};

export function StorageSection({
  register,
  volumeFields,
  getValues,
  volumeStats,
  volumeFieldError,
  organizationError,
  validateBusy,
  onValidate,
  organizeBusy,
  organizeDisabled,
  organizeError,
  organizationJob,
  onOrganize,
  messages,
}: {
  register: UseFormRegister<SettingsForm>;
  volumeFields: UseFieldArrayReturn<SettingsForm, "volumes", "fieldKey">;
  getValues: UseFormGetValues<SettingsForm>;
  volumeStats: VolumeHealth[] | undefined;
  volumeFieldError: (
    index: number,
    key: "label" | "downloadsPath" | "moviesPath" | "televisionPath",
  ) => string | undefined;
  organizationError?: string;
  validateBusy: boolean;
  onValidate: () => void;
  organizeBusy: boolean;
  organizeDisabled: boolean;
  organizeError?: string;
  organizationJob?: Job;
  onOrganize: () => void;
  messages: Messages;
}) {
  const organizing =
    organizationJob?.state === "pending" ||
    organizationJob?.state === "retrying" ||
    organizationJob?.state === "running";
  return (
    <section className="settings-section" id="storage">
      <header>
        <span className="settings-section__icon">
          <HardDrive size={20} />
        </span>
        <div>
          <h2>{messages.settings.storageTitle}</h2>
          <p>{messages.settings.storageBody}</p>
        </div>
      </header>
      <div className="storage-volumes">
        {volumeFields.fields.map((field, index) => {
          const stats = volumeStats?.find((volume) => volume.id === field.id);
          let freeLabel: string | undefined;
          if (stats) {
            freeLabel =
              stats.freeBytes === null
                ? messages.settings.volumeFreeUnknown
                : messages.settings.volumeFree({
                    size: formatBytes(stats.freeBytes),
                  });
          }
          return (
            <article className="storage-volume" key={field.fieldKey}>
              <div className="storage-volume__header">
                <Field
                  label={messages.settings.volumeLabel}
                  error={volumeFieldError(index, "label")}
                  {...register(`volumes.${index}.label`)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={volumeFields.fields.length === 1}
                  onClick={() => volumeFields.remove(index)}
                >
                  {messages.settings.removeVolume}
                </Button>
              </div>
              <input type="hidden" {...register(`volumes.${index}.id`)} />
              <div className="form-grid">
                <Field
                  label={messages.settings.downloadsPath}
                  error={volumeFieldError(index, "downloadsPath")}
                  {...register(`volumes.${index}.downloadsPath`)}
                />
                <Field
                  label={messages.settings.moviesPath}
                  error={volumeFieldError(index, "moviesPath")}
                  {...register(`volumes.${index}.moviesPath`)}
                />
                <Field
                  label={messages.settings.televisionPath}
                  error={volumeFieldError(index, "televisionPath")}
                  {...register(`volumes.${index}.televisionPath`)}
                />
              </div>
              {freeLabel ? (
                <p className="storage-volume__free">{freeLabel}</p>
              ) : null}
              {stats?.message && !stats.ok ? (
                <p className="field__error">{stats.message}</p>
              ) : null}
            </article>
          );
        })}
      </div>
      <p className="settings-muted">{messages.settings.volumePathHint}</p>
      <div className="storage-volume-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            const n = nextVolumeNumber(
              getValues("volumes").map((volume) => volume.id),
            );
            volumeFields.append({
              id: `volume-${n}`,
              label: messages.settings.volumeName({ n }),
              downloadsPath: "",
              moviesPath: "",
              televisionPath: "",
            });
          }}
        >
          <Plus size={17} /> {messages.settings.addVolume}
        </Button>
      </div>
      <SelectField
        label={messages.settings.organizationStrategy}
        hint={messages.settings.organizationHint}
        error={organizationError}
        {...register("organizationStrategy")}
      >
        <option value="hardlink">{messages.settings.hardlink}</option>
        <option value="symlink">{messages.settings.symlink}</option>
        <option value="copy">{messages.settings.copy}</option>
        <option value="move">{messages.settings.move}</option>
      </SelectField>
      <Button
        type="button"
        variant="secondary"
        busy={validateBusy}
        onClick={onValidate}
      >
        <FolderCheck size={17} /> {messages.settings.validatePaths}
      </Button>
      <div className="storage-organization">
        <h3>{messages.settings.organizeVolumes}</h3>
        <p className="settings-muted">
          {messages.settings.organizeVolumesHint}
        </p>
        {organizeDisabled ? (
          <p className="settings-muted">
            {messages.settings.organizeSaveFirst}
          </p>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          busy={organizeBusy || organizing}
          disabled={
            organizeDisabled || organizing || volumeFields.fields.length < 2
          }
          onClick={onOrganize}
        >
          <RefreshCw size={17} /> {messages.settings.organizeVolumes}
        </Button>
        {organizationJob ? (
          <p role="status">
            {messages.settings.organizationStatus[organizationJob.state]}{" "}
            <Link
              to={`/activity?tab=jobs&job=${encodeURIComponent(organizationJob.id)}`}
            >
              {messages.settings.viewOrganizationJob}
            </Link>
          </p>
        ) : null}
        {organizeError ? (
          <p role="alert" className="field__error">
            {organizeError}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function nextVolumeNumber(ids: readonly string[]): number {
  let n = 1;
  const used = new Set(ids);
  while (used.has(`volume-${n}`)) n += 1;
  return n;
}
