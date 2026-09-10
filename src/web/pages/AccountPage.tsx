import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { api } from "../api/client";
import { Page } from "../components/Page";
import { Button, Field } from "../components/ui";

const credentialsSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, "Use at least 3 characters.")
      .max(64)
      .regex(
        /^[a-zA-Z0-9._-]+$/,
        "Use letters, numbers, dots, underscores, or dashes.",
      ),
    password: z.string(),
    confirmation: z.string(),
  })
  .refine(
    (value) =>
      value.password.length === 0 || value.password === value.confirmation,
    {
      path: ["confirmation"],
      message: "Passwords do not match.",
    },
  );

type CredentialsForm = z.infer<typeof credentialsSchema>;

export function AccountPage() {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: ({ signal }) => api.get("currentSession", { signal }),
  });
  const form = useForm<CredentialsForm>({
    defaultValues: { username: "", password: "", confirmation: "" },
  });

  useEffect(() => {
    const username = sessionQuery.data?.user?.username;
    if (username) {
      form.reset({ username, password: "", confirmation: "" });
    }
  }, [form, sessionQuery.data]);

  const mutation = useMutation({
    mutationFn: (value: CredentialsForm) =>
      api.patch("updateCredentials", {
        body: {
          username: value.username,
          ...(value.password ? { password: value.password } : {}),
        },
      }),
    onSuccess: (result) => {
      form.reset({
        username: result.username,
        password: "",
        confirmation: "",
      });
      void queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
    },
  });

  return (
    <Page
      eyebrow="Account"
      title="Your sign-in"
      description="Change the username and password for this account."
    >
      <form
        className="settings-section"
        onSubmit={form.handleSubmit((value) => {
          const parsed = credentialsSchema.safeParse(value);
          if (!parsed.success) {
            for (const issue of parsed.error.issues) {
              const field = issue.path[0];
              if (
                field === "username" ||
                field === "password" ||
                field === "confirmation"
              ) {
                form.setError(field, { message: issue.message });
              }
            }
            return;
          }
          mutation.mutate(parsed.data);
        })}
      >
        <div className="form-grid">
          <Field
            label="Username"
            autoComplete="username"
            error={form.formState.errors.username?.message}
            {...form.register("username")}
          />
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            hint="Leave blank to keep the current password."
            error={form.formState.errors.password?.message}
            {...form.register("password")}
          />
          <Field
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            error={form.formState.errors.confirmation?.message}
            {...form.register("confirmation")}
          />
        </div>
        {mutation.isError ? (
          <p className="field__error">{mutation.error.message}</p>
        ) : null}
        {mutation.isSuccess ? (
          <p className="notice">Sign-in details updated.</p>
        ) : null}
        <Button
          type="submit"
          variant="secondary"
          busy={mutation.isPending}
          disabled={!form.formState.isDirty}
        >
          <KeyRound size={16} /> Update login
        </Button>
      </form>
    </Page>
  );
}
