import type { TextareaHTMLAttributes } from "react";

import { TextareaField } from "./ui";

interface TermFieldProps {
  input: TextareaHTMLAttributes<HTMLTextAreaElement>;
  error?: string;
}

export function ReleaseTermFields({
  required,
  preferred,
  rejected,
}: {
  required: TermFieldProps;
  preferred: TermFieldProps;
  rejected: TermFieldProps;
}) {
  return (
    <div className="form-grid form-grid--three">
      <TextareaField
        label="Required terms"
        rows={3}
        hint="Every comma-separated term must be present or the release is excluded."
        error={required.error}
        {...required.input}
      />
      <TextareaField
        label="Preferred terms"
        rows={3}
        hint="Comma-separated terms that raise a release score."
        error={preferred.error}
        {...preferred.input}
      />
      <TextareaField
        label="Rejected terms"
        rows={3}
        hint="Comma-separated terms that make a release ineligible."
        error={rejected.error}
        {...rejected.input}
      />
    </div>
  );
}
