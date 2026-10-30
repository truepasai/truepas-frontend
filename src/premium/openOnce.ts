import { router } from 'expo-router';

/** router.push pushes again on every tap, so a quick double tap opened the
 *  same screen twice (two Back presses to return). Taps within this window
 *  after an open are ignored. Shared by the tab bar and Home. */
const OPEN_GUARD_MS = 800;
let lastOpenAt = 0;

export function openOnce(href: string) {
  const now = Date.now();
  if (now - lastOpenAt < OPEN_GUARD_MS) return;
  lastOpenAt = now;
  router.push(href as never);
}
