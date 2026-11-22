import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const displayMode = matchMedia('(display-mode: standalone)');
let prompt: InstallPrompt | null = null;
let standalone = isStandalone();
const subscribers = new Set<() => void>();
let snapshot = { standalone, canPrompt: false };

function notify() {
  standalone = isStandalone();
  snapshot = { standalone, canPrompt: prompt !== null };
  subscribers.forEach((notifySubscriber) => notifySubscriber());
}

export function isStandalone() {
  return displayMode.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  prompt = event as InstallPrompt;
  notify();
});
window.addEventListener('appinstalled', () => {
  prompt = null;
  notify();
});
displayMode.addEventListener('change', notify);

function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function usePwa() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export async function install() {
  if (!prompt) return;
  const event = prompt;
  prompt = null;
  notify();
  await event.prompt();
  await event.userChoice;
}

if (import.meta.env.PROD) {
  registerSW({ onRegisterError: (error) => console.error('service worker', error) });
}
