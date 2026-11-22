import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../lib/preferences';

type WidgetOptions = {
  sitekey: string;
  size: 'flexible';
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
};
type TurnstileApi = { render(element: HTMLElement, options: WidgetOptions): string; remove(id: string): void };
const widgetWindow = window as Window & { turnstile?: TurnstileApi };
let loading: Promise<TurnstileApi> | undefined;

function loadWidget() {
  if (widgetWindow.turnstile) return Promise.resolve(widgetWindow.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => {
      if (widgetWindow.turnstile) resolve(widgetWindow.turnstile);
      else reject(new Error('Turnstile is not available'));
    };
    script.onerror = () => { script.remove(); reject(new Error('Turnstile is not available')); };
    document.head.append(script);
  }).catch((error: unknown) => { loading = undefined; throw error; });
  return loading;
}

export function Turnstile({ siteKey, revision, update }: { siteKey: string | null | undefined; revision: number; update: (value: string) => void }) {
  const node = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { tr } = useLocale();
  useEffect(() => {
    if (!siteKey) return;
    const target = node.current;
    if (!target) return;
    let widget: string | undefined;
    let alive = true;
    const currentKey = siteKey;
    setError(false);
    update('');
    void loadWidget().then((turnstile) => {
      if (!alive) return;
      widget = turnstile.render(target, {
        sitekey: currentKey, size: 'flexible',
        callback: (token) => { if (alive) { setError(false); update(token); } },
        'expired-callback': () => { if (alive) update(''); },
        'error-callback': () => { if (alive) { update(''); setError(true); } },
      });
    }).catch(() => { if (alive) setError(true); });
    return () => {
      alive = false;
      if (widget !== undefined) widgetWindow.turnstile?.remove(widget);
    };
  }, [siteKey, revision, update, attempt]);
  if (!siteKey) return null;
  return <div className="stack">
    <div ref={node} />
    {error && <button className="button secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>{tr('重新加载人机验证', 'Reload verification')}</button>}
  </div>;
}
