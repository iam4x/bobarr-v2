import type { TextareaHTMLAttributes } from "react";

import { TextareaField } from "./ui";
import { useUi } from "../i18n/ui";

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
  const { messages } = useUi();
  return (
    <div className="form-grid form-grid--three">
      <TextareaField
        label={messages.terms.required}
        rows={3}
        hint={messages.terms.requiredHint}
        error={required.error}
        {...required.input}
      />
      <TextareaField
        label={messages.terms.preferred}
        rows={3}
        hint={messages.terms.preferredHint}
        error={preferred.error}
        {...preferred.input}
      />
      <TextareaField
        label={messages.terms.rejected}
        rows={3}
        hint={messages.terms.rejectedHint}
        error={rejected.error}
        {...rejected.input}
      />
    </div>
  );
}
