import type { Messages } from "../i18n/en";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";

import { ApiError, api } from "../api/client";
import { isAuthenticated, isSetupRequired } from "../api/normalize";
import { Brand } from "../components/Brand";
import { Button, Field, InlineSpinner } from "../components/ui";
import { LocaleSwitcher, useUi } from "../i18n/ui";

function loginSchema(messages: Messages) {
  return z.object({
    username: z.string().min(1, messages.auth.enterUsername),
    password: z.string().min(1, messages.auth.enterPassword),
  });
}

function setupSchema(messages: Messages) {
  return z
    .object({
      username: z.string().trim().min(3, messages.auth.minUsername).max(64),
      password: z.string().min(1, messages.auth.enterAPassword),
      confirmation: z.string(),
    })
    .refine((value) => value.password === value.confirmation, {
      path: ["confirmation"],
      message: messages.auth.passwordsMismatch,
    });
}

type LoginForm = z.infer<ReturnType<typeof loginSchema>>;
type SetupForm = z.infer<ReturnType<typeof setupSchema>>;

function AuthLayout({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { messages } = useUi();
  return (
    <main className="auth-layout">
      <section className="auth-story" aria-label={messages.auth.about}>
        <Link to="/discover" className="auth-story__brand">
          <Brand />
        </Link>
        <div className="auth-story__copy">
          <span className="eyebrow">{messages.auth.privateByDesign}</span>
          <h2>
            {messages.auth.storyTitleLine1}
            <br />
            {messages.auth.storyTitleLine2}
          </h2>
          <p>{messages.auth.storyBody}</p>
        </div>
        <ul className="auth-story__features">
          <li>
            <Check size={16} /> {messages.auth.featureJackett}
          </li>
          <li>
            <Check size={16} /> {messages.auth.featureTransmission}
          </li>
          <li>
            <Check size={16} /> {messages.auth.featureOrganize}
          </li>
        </ul>
      </section>
      <section className="auth-panel">
        <div className="auth-panel__mobile-brand">
          <Brand />
        </div>
        <div className="auth-card">
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
          {children}
          <LocaleSwitcher labeled />
        </div>
        <p className="auth-footer">{messages.auth.footer}</p>
      </section>
    </main>
  );
}

function applyApiFieldErrors<T extends Record<string, string>>(
  error: unknown,
  setError: (name: keyof T, error: { message: string }) => void,
) {
  if (!(error instanceof ApiError) || !error.fieldErrors) return;
  for (const [field, messages] of Object.entries(error.fieldErrors)) {
    if (messages[0]) setError(field as keyof T, { message: messages[0] });
  }
}

export function LoginPage() {
  const { messages } = useUi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: ({ signal }) => api.get("currentSession", { signal }),
    retry: false,
  });
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<LoginForm>();
  const loginMutation = useMutation({
    mutationFn: (value: LoginForm) => api.post("login", { body: value }),
    onSuccess: (session) => {
      queryClient.setQueryData(["auth", "session"], session);
      navigate("/discover", { replace: true });
    },
    onError: (error) => applyApiFieldErrors<LoginForm>(error, setError),
  });

  if (isAuthenticated(sessionQuery.data))
    return <Navigate to="/discover" replace />;

  const submit = (value: LoginForm) => {
    clearErrors();
    const parsed = loginSchema(messages).safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "username" || field === "password")
          setError(field, { message: issue.message });
      }
      return;
    }
    loginMutation.mutate(parsed.data);
  };

  return (
    <AuthLayout
      eyebrow={messages.auth.loginEyebrow}
      title={messages.auth.loginTitle}
      description={messages.auth.loginDescription}
    >
      <form className="auth-form" onSubmit={handleSubmit(submit)}>
        <Field
          label={messages.auth.username}
          autoComplete="username"
          autoFocus
          error={errors.username?.message}
          {...register("username")}
        />
        <Field
          label={messages.auth.password}
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register("password")}
        />
        {loginMutation.isError ? (
          <div className="notice notice--error" role="alert">
            <LockKeyhole size={17} />
            {loginMutation.error.message}
          </div>
        ) : null}
        <Button type="submit" size="lg" busy={loginMutation.isPending}>
          {messages.auth.signIn} <ArrowRight size={17} />
        </Button>
      </form>
      <div className="auth-help">
        <KeyRound size={17} />
        <span>
          <strong>{messages.auth.lostAccessLead}</strong>
          {messages.auth.lostAccessRest}
        </span>
      </div>
    </AuthLayout>
  );
}

export function SetupPage() {
  const { messages } = useUi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ["setup"],
    queryFn: ({ signal }) => api.get("setupStatus", { signal }),
    retry: false,
  });
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<SetupForm>();
  const setupMutation = useMutation({
    mutationFn: ({ username, password: nextPassword }: SetupForm) =>
      api.post("setup", {
        body: { username, password: nextPassword },
      }),
    onSuccess: (session) => {
      queryClient.setQueryData(["auth", "session"], session);
      queryClient.setQueryData(["setup"], { setupRequired: false });
      navigate("/settings#connections", { replace: true });
    },
    onError: (error) => applyApiFieldErrors<SetupForm>(error, setError),
  });

  useEffect(() => {
    if (statusQuery.data && !isSetupRequired(statusQuery.data))
      navigate("/login", { replace: true });
  }, [navigate, statusQuery.data]);

  const submit = (value: SetupForm) => {
    clearErrors();
    const parsed = setupSchema(messages).safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (
          field === "username" ||
          field === "password" ||
          field === "confirmation"
        )
          setError(field, { message: issue.message });
      }
      return;
    }
    setupMutation.mutate(parsed.data);
  };

  if (statusQuery.isLoading)
    return (
      <main className="full-page-state">
        <Brand />
        <InlineSpinner label={messages.auth.checkingServer} />
      </main>
    );

  return (
    <AuthLayout
      eyebrow={messages.auth.setupEyebrow}
      title={messages.auth.setupTitle}
      description={messages.auth.setupDescription}
    >
      <form className="auth-form" onSubmit={handleSubmit(submit)}>
        <Field
          label={messages.auth.adminUsername}
          autoComplete="username"
          autoFocus
          error={errors.username?.message}
          {...register("username")}
        />
        <Field
          label={messages.auth.password}
          type="password"
          autoComplete="new-password"
          hint={messages.auth.passwordHint}
          error={errors.password?.message}
          {...register("password")}
        />
        <Field
          label={messages.auth.confirmPassword}
          type="password"
          autoComplete="new-password"
          error={errors.confirmation?.message}
          {...register("confirmation")}
        />
        {setupMutation.isError ? (
          <div className="notice notice--error" role="alert">
            {setupMutation.error.message}
          </div>
        ) : null}
        <Button type="submit" size="lg" busy={setupMutation.isPending}>
          {messages.auth.createAdministrator} <ArrowRight size={17} />
        </Button>
      </form>
      <div className="auth-help">
        <ShieldCheck size={18} />
        <span>{messages.auth.setupHelp}</span>
      </div>
    </AuthLayout>
  );
}

type InviteForm = SetupForm;

export function InvitePage() {
  const { messages } = useUi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const previewQuery = useQuery({
    queryKey: ["invite", "preview", token],
    queryFn: ({ signal }) =>
      api.get("previewInvite", { query: { token }, signal }),
    enabled: token.length > 0,
    retry: false,
  });
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<InviteForm>();
  const acceptMutation = useMutation({
    mutationFn: (value: InviteForm) =>
      api.post("acceptInvite", {
        body: {
          token,
          username: value.username,
          password: value.password,
        },
      }),
    onSuccess: (session) => {
      queryClient.setQueryData(["auth", "session"], session);
      queryClient.setQueryData(["setup"], { setupRequired: false });
      navigate("/discover", { replace: true });
    },
    onError: (error) => applyApiFieldErrors<InviteForm>(error, setError),
  });

  const submit = (value: InviteForm) => {
    clearErrors();
    const parsed = setupSchema(messages).safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (
          field === "username" ||
          field === "password" ||
          field === "confirmation"
        ) {
          setError(field, { message: issue.message });
        }
      }
      return;
    }
    acceptMutation.mutate(parsed.data);
  };

  if (token.length === 0 || previewQuery.isError) {
    return (
      <AuthLayout
        eyebrow={messages.auth.inviteEyebrow}
        title={messages.auth.inviteInvalidTitle}
        description={messages.auth.inviteInvalidDescription}
      >
        <Button type="button" onClick={() => navigate("/login")}>
          {messages.auth.goToSignIn}
        </Button>
      </AuthLayout>
    );
  }

  if (previewQuery.isLoading) {
    return (
      <main className="full-page-state">
        <Brand />
        <InlineSpinner label={messages.auth.checkingInvite} />
      </main>
    );
  }

  return (
    <AuthLayout
      eyebrow={messages.auth.invitedEyebrow}
      title={messages.auth.inviteTitle}
      description={messages.auth.inviteDescription}
    >
      <form className="auth-form" onSubmit={handleSubmit(submit)}>
        <Field
          label={messages.auth.username}
          autoComplete="username"
          autoFocus
          error={errors.username?.message}
          {...register("username")}
        />
        <Field
          label={messages.auth.password}
          type="password"
          autoComplete="new-password"
          error={errors.password?.message}
          {...register("password")}
        />
        <Field
          label={messages.auth.confirmPassword}
          type="password"
          autoComplete="new-password"
          error={errors.confirmation?.message}
          {...register("confirmation")}
        />
        {acceptMutation.isError ? (
          <div className="notice notice--error" role="alert">
            {acceptMutation.error.message}
          </div>
        ) : null}
        <Button type="submit" size="lg" busy={acceptMutation.isPending}>
          {messages.auth.join} <ArrowRight size={17} />
        </Button>
      </form>
    </AuthLayout>
  );
}

export function SetupUnavailable() {
  const { messages } = useUi();
  return (
    <AuthLayout
      eyebrow={messages.auth.unavailableEyebrow}
      title={messages.auth.unavailableTitle}
      description={messages.auth.unavailableDescription}
    >
      <Button
        type="button"
        variant="secondary"
        onClick={() => window.location.reload()}
      >
        {messages.common.tryAgain}
      </Button>
    </AuthLayout>
  );
}
