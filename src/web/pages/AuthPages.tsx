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

const loginSchema = z.object({
  username: z.string().min(1, "Enter your username."),
  password: z.string().min(1, "Enter your password."),
});

const setupSchema = z
  .object({
    username: z.string().trim().min(3, "Use at least 3 characters.").max(64),
    password: z.string().min(1, "Enter a password."),
    confirmation: z.string(),
  })
  .refine((value) => value.password === value.confirmation, {
    path: ["confirmation"],
    message: "Passwords do not match.",
  });

type LoginForm = z.infer<typeof loginSchema>;
type SetupForm = z.infer<typeof setupSchema>;

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
  return (
    <main className="auth-layout">
      <section className="auth-story" aria-label="About Bobarr">
        <Link to="/discover" className="auth-story__brand">
          <Brand />
        </Link>
        <div className="auth-story__copy">
          <span className="eyebrow">Private by design</span>
          <h2>
            Your watchlist,
            <br />
            quietly automated.
          </h2>
          <p>
            Find a title. Bobarr handles the search, the download, and the
            filing—on infrastructure you own.
          </p>
        </div>
        <ul className="auth-story__features">
          <li>
            <Check size={16} /> Jackett-powered release search
          </li>
          <li>
            <Check size={16} /> Transmission safely behind the API
          </li>
          <li>
            <Check size={16} /> Files organized without giving up seeding
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
        </div>
        <p className="auth-footer">Bobarr runs entirely on your server.</p>
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
    const parsed = loginSchema.safeParse(value);
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
      eyebrow="Welcome back"
      title="Sign in to Bobarr"
      description="Use your Bobarr username and password."
    >
      <form className="auth-form" onSubmit={handleSubmit(submit)}>
        <Field
          label="Username"
          autoComplete="username"
          autoFocus
          error={errors.username?.message}
          {...register("username")}
        />
        <Field
          label="Password"
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
          Sign in <ArrowRight size={17} />
        </Button>
      </form>
      <div className="auth-help">
        <KeyRound size={17} />
        <span>
          <strong>Lost access?</strong> Reset the administrator password from
          the Bobarr host.
        </span>
      </div>
    </AuthLayout>
  );
}

export function SetupPage() {
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
    const parsed = setupSchema.safeParse(value);
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
        <InlineSpinner label="Checking server…" />
      </main>
    );

  return (
    <AuthLayout
      eyebrow="First run"
      title="Make Bobarr yours"
      description="Create the single administrator account. You can configure services next."
    >
      <form className="auth-form" onSubmit={handleSubmit(submit)}>
        <Field
          label="Administrator username"
          autoComplete="username"
          autoFocus
          error={errors.username?.message}
          {...register("username")}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="Any non-empty password"
          error={errors.password?.message}
          {...register("password")}
        />
        <Field
          label="Confirm password"
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
          Create administrator <ArrowRight size={17} />
        </Button>
      </form>
      <div className="auth-help">
        <ShieldCheck size={18} />
        <span>
          Your password is hashed with Argon2id. Connector secrets are encrypted
          separately.
        </span>
      </div>
    </AuthLayout>
  );
}

const inviteSchema = z
  .object({
    username: z.string().trim().min(3, "Use at least 3 characters.").max(64),
    password: z.string().min(1, "Enter a password."),
    confirmation: z.string(),
  })
  .refine((value) => value.password === value.confirmation, {
    path: ["confirmation"],
    message: "Passwords do not match.",
  });

type InviteForm = z.infer<typeof inviteSchema>;

export function InvitePage() {
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
    const parsed = inviteSchema.safeParse(value);
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
        eyebrow="Invite"
        title="This invite isn’t valid"
        description="Ask an administrator for a new link. Used and expired invites cannot be reused."
      >
        <Button type="button" onClick={() => navigate("/login")}>
          Go to sign in
        </Button>
      </AuthLayout>
    );
  }

  if (previewQuery.isLoading) {
    return (
      <main className="full-page-state">
        <Brand />
        <InlineSpinner label="Checking invite…" />
      </main>
    );
  }

  return (
    <AuthLayout
      eyebrow="You're invited"
      title="Create your Bobarr account"
      description="Choose a username and password. You’ll share this library with the people already here."
    >
      <form className="auth-form" onSubmit={handleSubmit(submit)}>
        <Field
          label="Username"
          autoComplete="username"
          autoFocus
          error={errors.username?.message}
          {...register("username")}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          error={errors.password?.message}
          {...register("password")}
        />
        <Field
          label="Confirm password"
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
          Join Bobarr <ArrowRight size={17} />
        </Button>
      </form>
    </AuthLayout>
  );
}

export function SetupUnavailable() {
  return (
    <AuthLayout
      eyebrow="Server unavailable"
      title="Bobarr isn’t responding"
      description="Check that the container is running, then refresh this page."
    >
      <Button
        type="button"
        variant="secondary"
        onClick={() => window.location.reload()}
      >
        Try again
      </Button>
    </AuthLayout>
  );
}
