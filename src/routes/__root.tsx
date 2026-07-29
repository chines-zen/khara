import "../styles.css";

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
} from "@tanstack/react-router";
import { EmailCaptureDialog } from "@/components/opportunities/EmailCaptureDialog";
import { ManagerScopeSetupDialog } from "@/components/opportunities/ManagerScopeSetupDialog";
import {
  MANAGER_SCOPE_GATE_QUERY_KEY,
  fetchManagerNeedsScopeSetup,
} from "@/lib/api/manager-scope";
import { ME_QUERY_KEY, fetchMe } from "@/lib/api/me";
import { useDevMode } from "@/hooks/use-dev-mode";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
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
          Something went wrong on our end. You can try refreshing or head back home.
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

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
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
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // index.html already provides <html>/<body>; this mounts into its
  // <div id="root">. React hoists title/meta/link to the real <head>
  // regardless of where they're rendered, so per-route head() tags still
  // apply without needing our own <html>/<head> here.
  return (
    <QueryClientProvider client={queryClient}>
      <HeadContent />
      <EmailSetupGate />
      <ManagerScopeGate />
      <Outlet />
    </QueryClientProvider>
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

// DEV_MODE only: blocks the app behind a first-use email capture dialog until
// a real email has been provided (see needsEmailSetup in middleware/auth.js).
function EmailSetupGate() {
  const queryClient = useQueryClient();
  const devMode = useDevMode();
  const { me } = useMe();

  const handleSave = async (email: string) => {
    const response = await fetch("/api/dev/session-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.details || data?.error || "Failed to connect to Snowflake");
    }

    // The captured email changes who we are, so every identity-derived query has
    // to be refetched — /api/me first, since the gates and manager scoping read it.
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ["opportunities"] });
  };

  if (!devMode) return null;

  return (
    <EmailCaptureDialog
      open={Boolean(me?.needsEmailSetup)}
      onSave={handleSave}
    />
  );
}
