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

const darkScheme = matchMedia('(prefers-color-scheme: dark)');

function applyPreferences() {
  document.documentElement.lang = preferences.lang === 'zh' ? 'zh-CN' : 'en';
  document.documentElement.dataset.theme = preferences.theme;
  const dark = preferences.theme === 'dark' || (preferences.theme === 'system' && darkScheme.matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#131620' : '#f1f3f7');
}
applyPreferences();
darkScheme.addEventListener('change', applyPreferences);

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
  const locale = state.lang === 'zh' ? 'zh-CN' : 'en';
  const date = (time: number | null) => time === null ? tr('从未', 'Never') : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(time);
  const day = (time: number) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(time);
  return { ...state, tr, date, day };
}
