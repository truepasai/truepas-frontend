import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { RotateCcw, TriangleAlert } from 'lucide-react-native';
import { useEffect } from 'react';
import { AppState, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider } from 'react-redux';

import { SessionExpiredError, setOnSessionExpired } from '@/api/client';
import { FieldLabelStyleProvider, ToastProvider } from '@/components/composite';
import { sessionEnded } from '@/features/auth/slice';
import { resetMemberPhotoSync } from '@/features/family/hooks';
import { clearAllProfileImages } from '@/services/profileImageStore';
import { store } from '@/store';
import { AppStatusBar } from '@/premium/statusBar';
import { C } from '@/premium/theme';
import { Button } from '@/premium/ui';
import { ResultView } from '@/premium/views';
import { ThemeProvider, useTruepasFonts } from '@/theme';

import '@/global.css';
import { AppLock } from '@/features/settings/AppLock';
import { loadPrefs } from '@/services/prefs';

// Settings (haptics, app lock) are read once, before anything uses them.
void loadPrefs();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A dead session can't be fixed by retrying — it would just re-fire
      // the refresh failure and the session-expired handler.
      retry: (failureCount, error) =>
        !(error instanceof SessionExpiredError) && failureCount < 2,
      staleTime: 60_000,
    },
  },
});

// React Query only knows about browser focus. On native, tell it when the app
// returns to the foreground so stale queries (e.g. check-in history after a
// venue check-in) refetch without a manual pull-to-refresh.
if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
    return () => sub.remove();
  });
}

// The API client fires this when the refresh token is missing or rejected.
// Without it the app stayed "authenticated" in Redux while every request
// 401'd — the repeated NO_REFRESH_TOKEN / "couldn't load" error loop.
setOnSessionExpired(() => {
  // Already signed out (a deliberate logout): a stray 401 from a screen that
  // was still unmounting is expected — not an expired session to announce.
  if (store.getState().auth.status !== 'authenticated') return;
  queryClient.clear();
  store.dispatch(sessionEnded());
  // Forced logout gets the same teardown as a manual logout. Captured
  // document scans are kept — the backend can't return them, so wiping
  // here lost every passport photo on token expiry (see useLogoutFlow).
  void clearAllProfileImages().catch(() => {});
  resetMemberPhotoSync();
  if (router.canDismiss()) {
    router.dismissAll();
  }
  // reason → the login screen explains why the session ended instead of
  // dumping the user on a bare login form.
  router.replace({ pathname: '/(auth)/login', params: { reason: 'session-expired' } } as never);
});

function RootShell({ children }: { children: React.ReactNode }) {
  const [fontsLoaded, fontError] = useTruepasFonts();
  useEffect(() => {
    if (fontError) console.warn('[Fonts] failed to load — using system fonts', fontError);
  }, [fontError]);
  // A font that fails to load must not hold the app on a blank screen.
  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: C.canvas }} />;
  }

  return (
    <>
      <AppStatusBar />
      {children}
      <AppLock />
    </>
  );
}

/** Renders inside ThemeProvider so the stack's behind-screen color tracks
 *  the active palette instead of flashing white during transitions. */
function RootStack() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        // Premium showcase canvas

        contentStyle: { backgroundColor: C.canvas },
      }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(onboarding)" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <ThemeProvider scheme="light"palette="violetLedger" typeface="grotesk">
            <FieldLabelStyleProvider>
              <ToastProvider>
                <RootShell>
                  <RootStack />
                </RootShell>
              </ToastProvider>
            </FieldLabelStyleProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </Provider>
  );
}

/** Catches a render error from any screen (none exports its own boundary),
 *  so a release build shows this instead of closing. expo-router renders it
 *  IN PLACE of RootLayout: no Redux/Query/theme providers, font gate or
 *  AppStatusBar here — only the static premium primitives. The error itself
 *  is never shown to the user. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    // warn, not error: babel.config.js strips it from release builds
    // (device logs are a data-leak surface).
    console.warn('[ErrorBoundary] Unhandled render error', error);
  }, [error]);

  // Back to the entry gate (`/`), which routes by session state — the same
  // reset as the not-found screen. While this shows, the root state is just
  // `__root` (the stack below is gone); replace still swaps this screen out
  // for `/` (checked on web with a screen that throws on render).
  const goHome = () => {
    if (router.canDismiss()) router.dismissAll();
    router.replace('/');
  };

  return (
    <>
      {/* Always the light canvas — RootShell's AppStatusBar is unmounted. */}
      <StatusBar style="dark" />
      <ResultView
        close
        icon={TriangleAlert}
        tone="red"
        over="Unexpected error"
        title="Something went"
        accent="wrong."
        sub="TruePas ran into a problem showing this screen. Try again, or head back to the home screen."
        primary={<Button label="Try again" icon={RotateCcw} onPress={() => void retry()} />}
        secondary={<Button label="Back to home" tone="ghost" onPress={goHome} />}
      />
    </>
  );
}
