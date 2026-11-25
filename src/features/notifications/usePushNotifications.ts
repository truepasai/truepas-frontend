/**
 * Wires phone push into the app (mounted once in the root layout):
 * - registers this phone once the user is signed in and past face
 *   enrolment (so the permission prompt doesn't land mid-onboarding),
 * - refreshes the inbox when a push arrives while the app is open,
 * - opens the item's screen when a push is tapped — including the tap that
 *   launched the app, held until the entry gate has restored the session.
 */
import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { notificationKeys } from '@/features/notifications/hooks';
import { notificationHref } from '@/features/notifications/links';
import { registerForPush, watchPushToken } from '@/services/pushNotifications';
import { store, useAppSelector } from '@/store';
import type { NotificationData } from '@/types/domain';

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

function dataOf(n: Notifications.Notification): NotificationData {
  return (n.request.content.data ?? {}) as NotificationData;
}

export function usePushNotifications() {
  const qc = useQueryClient();
  const { status, faceEnrolled, user } = useAppSelector((s) => s.auth);
  const ready = status === 'authenticated' && faceEnrolled;
  const selfId = user?.id;
  // A tap waiting for the session (cold start) — a ref, not state: opening it
  // is a side effect, not something to render.
  const pendingTap = useRef<NotificationData | null>(null);

  const openTap = useCallback((data: NotificationData) => {
    // Read at call time: the listener outlives the render it was set up in.
    const auth = store.getState().auth;
    if (auth.status !== 'authenticated' || !auth.faceEnrolled) {
      pendingTap.current = data;
      return;
    }
    pendingTap.current = null;
    void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    const href = notificationHref({ type: data.type, data }, auth.user?.id) ?? '/notification';
    // Let the entry gate's redirect to the tabs land first, then open on top.
    setTimeout(() => router.push(href as never), 400);
  }, []);

  useEffect(() => {
    if (!isNative || !ready) return;
    void registerForPush();
    return watchPushToken();
  }, [ready, selfId]);

  useEffect(() => {
    if (!isNative) return;
    const received = Notifications.addNotificationReceivedListener(() => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    });
    const tapped = Notifications.addNotificationResponseReceivedListener((r) => openTap(dataOf(r.notification)));
    // The tap that cold-started the app fires before the listener exists.
    const launch = Notifications.getLastNotificationResponse();
    if (launch) openTap(dataOf(launch.notification));
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [qc, openTap]);

  useEffect(() => {
    if (ready && pendingTap.current) openTap(pendingTap.current);
  }, [ready, openTap]);
}
