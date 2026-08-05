import "../styles.css";

import * as React from "react";

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
} from "@tanstack/react-router";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { ManagerScopeSetupDialog } from "@/components/opportunities/ManagerScopeSetupDialog";
import {
  MANAGER_SCOPE_GATE_QUERY_KEY,
  fetchManagerNeedsScopeSetup,
} from "@/lib/api/manager-scope";
import { ME_QUERY_KEY, fetchMe } from "@/lib/api/me";
import { saveUserPreference } from "@/lib/api/user-preferences";
import { AppNav } from "@/components/opportunities/AppNav";
import { HEALTH_QUERY_KEY, fetchHealth } from "@/lib/api/health";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">
          Page not found
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back
          home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "KHARA" },
      ],
    }),
    component: RootComponent,
    notFoundComponent: NotFoundComponent,
    errorComponent: ErrorComponent,
  },
);

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const { data: health, isPending: healthPending } = useQuery({
    queryKey: HEALTH_QUERY_KEY,
    queryFn: fetchHealth,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const { me, isPending: mePending } = useMe();
  const [onboardingStarted, setOnboardingStarted] = React.useState(false);
  const devMode = Boolean(health?.devMode);
  const onboardingActive = Boolean(
    devMode &&
    (onboardingStarted || me?.needsEmailSetup || me?.needsOnboarding),
  );

  const handleEmailSave = async (email: string) => {
    setOnboardingStarted(true);
    const response = await fetch("/api/dev/session-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(
        data?.details || data?.error || "Failed to connect to Snowflake",
      );
    }
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    const updatedMe = await queryClient.fetchQuery({
      queryKey: ME_QUERY_KEY,
      queryFn: fetchMe,
      staleTime: Infinity,
    });
    const preferredName = updatedMe?.name?.trim().split(/\s+/)[0];
    if (preferredName) {
      await saveUserPreference("preferredName", preferredName);
    }

    if (!updatedMe?.needsOnboarding) {
      setOnboardingStarted(false);
      await router.navigate({ to: "/help" });
    }
  };

  const handleOnboardingFinished = async () => {
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    await queryClient.invalidateQueries({ queryKey: ["blindSpots"] });
    setOnboardingStarted(false);
    await router.navigate({ to: "/help" });
  };

  // index.html already provides <html>/<body>; this mounts into its
  // <div id="root">. React hoists title/meta/link to the real <head>
  // regardless of where they're rendered, so per-route head() tags still
  // apply without needing our own <html>/<head> here.
  if (healthPending || mePending) {
    return (
      <QueryClientProvider client={queryClient}>
        <HeadContent />
        <StartupLoading />
      </QueryClientProvider>
    );
  }

  if (onboardingActive) {
    return (
      <QueryClientProvider client={queryClient}>
        <HeadContent />
        <OnboardingFlow
          me={me}
          emailSetup={Boolean(me?.needsEmailSetup)}
          onEmailSave={handleEmailSave}
          onFinished={handleOnboardingFinished}
        />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <HeadContent />
      <ManagerScopeGate />
      <AppNav>
        <Outlet />
      </AppNav>
    </QueryClientProvider>
  );
}

function StartupLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zd-bg text-sm text-zd-teal/70">
      Loading Khara…
    </div>
  );
}

// Shared /api/me read. Both gates and useIsManager use this same query key, so a
// page load issues one request instead of one per consumer — each request runs
// the auth middleware's identity resolution, so duplicates cost Snowflake work.
function useMe() {
  const { data, isPending } = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    staleTime: Infinity,
    retry: false,
  });
  return { me: data ?? null, isPending };
}

// Managers whose account has no SEs configured yet can't run a meaningful first
// sync (their own name rarely owns opps), so block the app behind a dialog that
// sends them to Settings. Clears automatically once SE emails are saved.
function ManagerScopeGate() {
  const { me } = useMe();

  const { data: needsSetup } = useQuery({
    queryKey: [...MANAGER_SCOPE_GATE_QUERY_KEY, me?.isManager ?? null],
    queryFn: () => fetchManagerNeedsScopeSetup(me),
    // Wait for /api/me — without it every load would briefly resolve "not a
    // manager" and the gate would never show for those who need it.
    enabled: me !== null,
    retry: false,
  });

  // Don't cover the Settings page — that's where they enter the SE emails.
  const onSettings = useRouterState({
    select: (s) => s.location.pathname === "/settings",
  });

  return <ManagerScopeSetupDialog open={Boolean(needsSetup) && !onSettings} />;
}
