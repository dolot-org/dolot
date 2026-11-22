import { AlertCircle, Check, LoaderCircle } from 'lucide-react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { getPreferences, useLocale } from '../lib/preferences';

export function useAction() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function run(action: () => Promise<unknown>, success = '') {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : getPreferences().lang === 'zh' ? '操作失败' : 'The action failed');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return { run, busy, error, message };
}

export function ActionFeedback({ action }: { action: Pick<ReturnType<typeof useAction>, 'error' | 'message'> }) {
  return <>{action.error && <ErrorNotice message={action.error} />}{action.message && <p className="notice success" role="status"><Check size={17} />{action.message}</p>}</>;
}

export function ErrorNotice({ message }: { message: string }) {
  return <p className="notice error" role="alert"><AlertCircle size={17} />{message}</p>;
}

export function QueryState({ error, retry }: { error?: Error | null; retry?: () => void }) {
  const { tr } = useLocale();
  if (error) return <div className="stack"><ErrorNotice message={error.message} />{retry && <button className="button secondary" onClick={retry}>{tr('重试', 'Retry')}</button>}</div>;
  return <p className="loading" role="status"><LoaderCircle size={19} className="spin" />{tr('正在加载', 'Loading')}</p>;
}

export function Panel({ title, children, side }: { title: string; children: ReactNode; side?: ReactNode }) {
  return <section className="panel stack">
    <div className="section-head"><h2>{title}</h2>{side}</div>
    {children}
  </section>;
}

export function PageTitle({ title, subtitle, side }: { title: string; subtitle?: string; side?: ReactNode }) {
  return <header className="page-title"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{side}</header>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function formData(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return new FormData(event.currentTarget);
}

export function textValue(form: FormData, input: string) {
  return String(form.get(input) ?? '');
}

export function ConfirmAction({ label, expected, onConfirm }: { label: string; expected: string; onConfirm: () => Promise<unknown> }) {
  const { tr } = useLocale();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const action = useAction();
  if (!open) return <button type="button" className="button danger" onClick={() => setOpen(true)}>{label}</button>;
  return <form className="stack inset" onSubmit={(event) => {
    event.preventDefault();
    if (confirm !== expected) return;
    void action.run(async () => { await onConfirm(); setOpen(false); setConfirm(''); });
  }}>
    <Field label={tr('输入以下名称以确认', 'Enter this name to confirm')} hint={expected}>
      <input value={confirm} onChange={(event) => setConfirm(event.target.value)} required autoComplete="off" />
    </Field>
    <div className="actions">
      <button className="button danger" disabled={action.busy || confirm !== expected}>{label}</button>
      <button type="button" className="button secondary" disabled={action.busy} onClick={() => { setOpen(false); setConfirm(''); }}>{tr('取消', 'Cancel')}</button>
    </div>
    <ActionFeedback action={action} />
  </form>;
}
