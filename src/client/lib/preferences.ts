import { useSyncExternalStore } from 'react';
import type { Lang } from '../../shared/messages';

export type Theme = 'light' | 'dark' | 'system';
type Preferences = { lang: Lang; theme: Theme };

function loadPreferences(): Preferences {
  const language = localStorage.getItem('dotlo-language');
  const theme = localStorage.getItem('dotlo-theme');
  return {
    lang: language === 'en' || (!language && !navigator.language.toLowerCase().startsWith('zh')) ? 'en' : 'zh',
    theme: theme === 'dark' || theme === 'light' ? theme : 'system',
  };
}

let preferences = loadPreferences();
const listeners = new Set<() => void>();

function applyPreferences() {
  document.documentElement.lang = preferences.lang === 'zh' ? 'zh-CN' : 'en';
  document.documentElement.dataset.theme = preferences.theme;
}
applyPreferences();

export function setPreferences(next: Partial<Preferences>) {
  preferences = { ...preferences, ...next };
  localStorage.setItem('dotlo-language', preferences.lang);
  localStorage.setItem('dotlo-theme', preferences.theme);
  applyPreferences();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPreferences() {
  return preferences;
}

export function useLocale() {
  const state = useSyncExternalStore(subscribe, getPreferences);
  const tr = (zh: string, en: string) => state.lang === 'zh' ? zh : en;
  const date = (time: number | null) => time === null ? tr('从未', 'Never') : new Intl.DateTimeFormat(state.lang === 'zh' ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(time);
  return { ...state, tr, date };
}
