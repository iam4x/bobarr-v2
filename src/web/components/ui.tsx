import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";

import { AlertCircle, ChevronDown, Inbox, LoaderCircle, X } from "lucide-react";
import { useId } from "react";

import { ModalLayer } from "./ModalLayer";
import { ApiError } from "../api/client";

function classNames(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  busy?: boolean;
}

export function Button({
  children,
  className,
  variant = "primary",
  size = "md",
  busy = false,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={classNames(
        "button",
        `button--${variant}`,
        `button--${size}`,
        className,
      )}
      disabled={disabled || busy}
      {...props}
    >
      {busy ? (
        <LoaderCircle aria-hidden="true" className="spin" size={17} />
      ) : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      className={classNames("icon-button", className)}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "info";
  className?: string;
}) {
  return (
    <span className={classNames("badge", `badge--${tone}`, className)}>
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  label,
}: {
  value: number;
  label?: string;
}) {
  const normalized = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label ?? "Progress"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalized}
    >
      <span style={{ width: `${normalized}%` }} />
    </div>
  );
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "is-active" : undefined}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  className,
  ...inputProps
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  const generatedId = useId();
  const inputId = inputProps.id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  let describedBy: string | undefined;
  if (error) describedBy = errorId;
  else if (hint) describedBy = hintId;
  let supportingText: ReactNode;
  if (error)
    supportingText = (
      <span className="field__error" id={errorId}>
        {error}
      </span>
    );
  else if (hint)
    supportingText = (
      <span className="field__hint" id={hintId}>
        {hint}
      </span>
    );

  return (
    <label className={classNames("field", className)} htmlFor={inputId}>
      <span className="field__label">{label}</span>
      <input
        {...inputProps}
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
      />
      {supportingText}
    </label>
  );
}

export function SelectField({
  label,
  hint,
  error,
  children,
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  const generatedId = useId();
  const selectId = props.id ?? generatedId;
  const labelId = `${selectId}-label`;
  const hintId = `${selectId}-hint`;
  const errorId = `${selectId}-error`;
  let describedBy: string | undefined;
  if (error) {
    describedBy = errorId;
  } else if (hint) {
    describedBy = hintId;
  }
  return (
    <label className={classNames("field", className)} htmlFor={selectId}>
      <span className="field__label" id={labelId}>
        {label}
      </span>
      <SelectControl
        {...props}
        id={selectId}
        aria-invalid={Boolean(error)}
        aria-labelledby={labelId}
        aria-describedby={describedBy}
      >
        {children}
      </SelectControl>
      {error ? (
        <span className="field__error" id={errorId}>
          {error}
        </span>
      ) : null}
      {!error && hint ? (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function SelectControl({
  children,
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={classNames("select-control", className)}>
      <select {...props}>{children}</select>
      <ChevronDown
        className="select-control__icon"
        aria-hidden="true"
        size={18}
        strokeWidth={2}
      />
    </span>
  );
}

export function TextareaField({
  label,
  hint,
  error,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  const generatedId = useId();
  const textareaId = props.id ?? generatedId;
  return (
    <label className={classNames("field", className)} htmlFor={textareaId}>
      <span className="field__label">{label}</span>
      <textarea {...props} id={textareaId} aria-invalid={Boolean(error)} />
      {error ? <span className="field__error">{error}</span> : null}
      {!error && hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function SkeletonGrid({ count = 10 }: { count?: number }) {
  return (
    <div className="poster-grid" aria-label="Loading titles" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="media-card media-card--skeleton" key={index}>
          <div className="skeleton media-card__image" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line-short" />
        </div>
      ))}
    </div>
  );
}

export function InlineSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="inline-spinner" role="status">
      <LoaderCircle aria-hidden="true" className="spin" size={18} />
      {label}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-card state-card--empty">
      <span className="state-card__icon" aria-hidden="true">
        <Inbox size={24} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  error,
  title = "Something went wrong",
  onRetry,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
}) {
  const message =
    error instanceof Error
      ? error.message
      : "The request could not be completed.";
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div className="state-card state-card--error" role="alert">
      <span className="state-card__icon" aria-hidden="true">
        <AlertCircle size={24} />
      </span>
      <h2>{title}</h2>
      <p>{message}</p>
      {requestId ? <small>Request {requestId}</small> : null}
      {onRetry ? (
        <Button type="button" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  size = "md",
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <ModalLayer
      open={open}
      onDismiss={onClose}
      labelledBy={titleId}
      describedBy={description ? descriptionId : undefined}
      backdropClassName="dialog-backdrop"
      surfaceClassName={classNames("dialog", `dialog--${size}`)}
      sheet={{ kind: "drag-handle", availability: "compact" }}
    >
      <header className="dialog__header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
        </div>
        <IconButton label="Close dialog" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </header>
      <div className="dialog__content">{children}</div>
    </ModalLayer>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

export function Stack({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={classNames("stack", className)} {...props} />;
}

export { classNames };
