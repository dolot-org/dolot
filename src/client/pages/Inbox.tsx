import { useQuery } from '@tanstack/react-query';
import {
  Archive, ArrowLeft, ArrowRight, Clipboard, FileText, Inbox as InboxIcon, Mail, MailOpen,
  Paperclip, Plus, RefreshCw, RotateCcw, Search, Send, Settings2, Star, Trash2,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { MAIL_FOLDERS, type MailDetail, type MailFolder, type MailOperation, type MailStatus, type MailSummary } from '../../shared/mail';
import type { Paged } from '../../shared/types';
import { MailCompose, type ComposeSeed } from '../components/MailCompose';
import { MailReader } from '../components/MailReader';
import { ActionFeedback, ConfirmAction, Field, Meter, PageTitle, Panel, QueryState, useAction } from '../components/ui';
import { api, invalidate } from '../lib/api';
import { useLocale } from '../lib/preferences';

const folderIcons = { inbox: InboxIcon, starred: Star, sent: Send, drafts: FileText, archive: Archive, trash: Trash2 };

export function Inbox() {
  const { tr } = useLocale();
  const query = useQuery({
    queryKey: ['mail-status'],
    queryFn: ({ signal }) => api<MailStatus>('/mail/status', 'GET', undefined, signal),
    refetchInterval: 30_000,
  });
  if (!query.data) return <div className="stack">
    <PageTitle title={tr('邮箱', 'Mail')} />
    <QueryState error={query.error} retry={() => void query.refetch()} />
  </div>;
  return query.data.mailbox
    ? <Mailbox key={query.data.mailbox.address} status={query.data} address={query.data.mailbox.address} />
    : <MailboxClaim domains={query.data.domains} />;
}

function MailboxClaim({ domains }: { domains: string[] }) {
  const { tr } = useLocale();
  const [label, setLabel] = useState('');
  const [domain, setDomain] = useState('');
  const suffix = domains.includes(domain) ? domain : domains[0];
  const action = useAction();

  return <div className="stack">
    <PageTitle title={tr('邮箱', 'Mail')} />
    <Panel title={tr('认领邮箱地址', 'Claim an email address')} className="mail-claim">
      {suffix ? <>
        <p className="muted">{tr('每个账户可认领一个邮箱地址', 'Each account can claim one email address')}</p>
        <form className="inline-form" onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            await api('/mail/claim', 'POST', { label, domain: suffix });
            await invalidate('mail-status');
          });
        }}>
          <Field label={tr('邮箱名称', 'Email name')}>
            <input className="mono" value={label} onChange={(event) => setLabel(event.target.value)} required maxLength={63}
              autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="yourname" />
          </Field>
          <Field label={tr('邮箱后缀', 'Email domain')}>
            <select className="mono" value={suffix} onChange={(event) => setDomain(event.target.value)}>
              {domains.map((item) => <option value={item} key={item}>@{item}</option>)}
            </select>
          </Field>
          <button className="button primary" disabled={action.busy}><Plus size={17} aria-hidden="true" />{tr('认领邮箱', 'Claim email')}</button>
        </form>
        <ActionFeedback action={action} />
        <Link className="back-link" to="/claim">{tr('同时认领域名和邮箱', 'Claim a domain and email together')}<ArrowRight size={16} aria-hidden="true" /></Link>
      </> : <p className="muted">{tr('本站暂未开放邮箱认领', 'Email address claims are currently unavailable')}</p>}
    </Panel>
  </div>;
}

function Mailbox({ status, address }: { status: MailStatus; address: string }) {
  const { tr } = useLocale();
  const [params, setParams] = useSearchParams();
  const current = params.get('folder');
  const folder = MAIL_FOLDERS.find((item) => item === current) ?? 'inbox';
  const query = (params.get('q') ?? '').slice(0, 120);
  const page = Math.min(100, Math.max(1, Number.parseInt(params.get('page') ?? '', 10) || 1));
  const id = params.get('message');
  const [compose, setCompose] = useState<ComposeSeed | null>(null);
  const [settings, setSettings] = useState(false);
  const action = useAction();
  const copies = useAction();
  const [selection, setSelection] = useState<{ key: string; items: string[] }>({ key: '', items: [] });
  const listKey = JSON.stringify([folder, page, query]);
  const list = useQuery({
    queryKey: ['mail-list', folder, page, query],
    queryFn: ({ signal }) => api<Paged<MailSummary>>('/mail/messages?' + new URLSearchParams({ folder, page: String(page), q: query }), 'GET', undefined, signal),
    refetchInterval: 30_000,
  });
  const reader = useQuery({
    queryKey: ['mail-detail', id],
    queryFn: ({ signal }) => api<MailDetail>('/mail/messages/' + encodeURIComponent(id ?? ''), 'GET', undefined, signal),
    enabled: !!id,
  });
  const message = id ? reader.data : null;
  const selected = selection.key === listKey
    ? selection.items.filter((item) => list.data?.items.some((row) => row.id === item && !row.sending)) : [];
  const setSelected = (items: string[]) => setSelection({ key: listKey, items });
  const labels: Record<MailFolder, string> = {
    inbox: tr('收件箱', 'Inbox'), starred: tr('星标', 'Starred'), sent: tr('已发送', 'Sent'),
    drafts: tr('草稿', 'Drafts'), archive: tr('归档', 'Archive'), trash: tr('废纸篓', 'Trash'),
  };

  function updateLocation(changes: Record<string, string | null>) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  }
  function changeFolder(next: MailFolder) {
    updateLocation({ folder: next === 'inbox' ? null : next, page: null, message: null, q: null });
    setSelected([]);
  }
  function changeMessages(ids: string[], operation: MailOperation) {
    return action.run(async () => {
      await api('/mail/messages', 'PATCH', { ids, operation });
      const moving = ['archive', 'inbox', 'trash', 'restore', 'delete'].includes(operation) ||
        (folder === 'starred' && operation === 'unstar');
      if (moving && id && ids.includes(id)) updateLocation({ message: null });
      setSelected([]);
      await invalidate('mail-list', 'mail-status', 'mail-detail');
    });
  }
  function done(next: 'drafts' | 'sent') {
    setCompose(null);
    changeFolder(next);
  }

  const openDraft = message?.folder === 'drafts' && !message.sending;
  const showReader = !!(id || compose);
  const rows = list.data?.items ?? [];
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / (list.data?.pageSize ?? 25)));
  useEffect(() => {
    if (list.data && page > pages) setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (pages === 1) next.delete('page');
      else next.set('page', String(pages));
      return next;
    }, { replace: true });
  }, [list.data, page, pages, setParams]);

  return <div className="stack mail-page">
    <PageTitle title={tr('邮箱', 'Mail')} subtitle={<span className="mail-identity">
      <Mail size={17} aria-hidden="true" /><span className="mono break">{address}</span>
      <button className="icon-button" aria-label={tr('复制地址', 'Copy address')} title={tr('复制地址', 'Copy address')}
        onClick={() => void copies.run(() => navigator.clipboard.writeText(address), tr('已复制', 'Copied'))}><Clipboard size={16} aria-hidden="true" /></button>
    </span>} side={<div className="actions">
      <button className="button secondary" aria-expanded={settings} onClick={() => setSettings(!settings)}>
        <Settings2 size={17} aria-hidden="true" />{tr('邮箱设置', 'Mailbox settings')}
      </button>
      <button className="button primary" disabled={!!compose || openDraft} onClick={() => setCompose({})}>
        <Plus size={19} aria-hidden="true" />{tr('写邮件', 'Compose')}
      </button>
    </div>} />
    <ActionFeedback action={copies} />
    {settings && <Panel title={tr('邮箱设置', 'Mailbox settings')} className="mail-settings">
      <div className="mail-storage">
        <strong>{tr('存储空间', 'Storage')}</strong>
        <span>{(status.bytesUsed / 1024 ** 2).toFixed(1)} / {status.bytesLimit / 1024 ** 2} MB</span>
        <Meter value={status.bytesUsed / status.bytesLimit} label={tr('已使用的邮箱空间', 'Mailbox storage used')} />
      </div>
      {!status.canSend && <p className="muted">{tr('此邮箱暂未开通发信', 'Sending is unavailable for this mailbox')}</p>}
      <p className="muted">{tr('释放后将永久删除邮件并停用此地址', 'Releasing this mailbox permanently deletes its messages and retires the address')}</p>
      <ConfirmAction expected={address} label={tr('释放邮箱', 'Release mailbox')} onConfirm={async () => {
        await api('/mail/mailbox', 'DELETE', { address });
        setParams({});
        await invalidate('mail-status', 'mail-list', 'mail-detail');
      }} />
    </Panel>}
    <ActionFeedback action={action} />

    <div className={'mail-workspace' + (showReader ? ' has-reader' : '')}>
      <nav className="mail-folders" aria-label={tr('邮件文件夹', 'Mail folders')}>
        {MAIL_FOLDERS.map((item) => {
          const Icon = folderIcons[item];
          return <button className={folder === item ? 'active' : ''} type="button" aria-current={folder === item ? 'page' : undefined}
            key={item} onClick={() => changeFolder(item)}>
            <Icon size={18} aria-hidden="true" /><span>{labels[item]}</span>
            {item === 'inbox' && status.unread > 0 && <strong aria-label={status.unread + tr(' 封未读', ' unread')}>{status.unread}</strong>}
          </button>;
        })}
      </nav>

      <section className="mail-list" aria-label={labels[folder]}>
        <div className="mail-list-head">
          <div className="mail-list-title">
            <h2>{labels[folder]}</h2>
            <button className="icon-button" type="button" disabled={list.isFetching} title={tr('刷新', 'Refresh')} aria-label={tr('刷新', 'Refresh')}
              onClick={() => void Promise.all([list.refetch(), invalidate('mail-status')])}><RefreshCw className={list.isFetching ? 'spin' : ''} size={17} aria-hidden="true" /></button>
          </div>
          <MailSearch key={query} query={query} submit={(value) => updateLocation({ q: value, page: null, message: null })} />
          {rows.length > 0 && <BulkActions key={listKey} rows={rows} selected={selected} setSelected={setSelected} folder={folder} busy={action.busy}
            apply={(operation) => void changeMessages(selected, operation)} />}
        </div>
        {list.isError || !list.data ? <div className="mail-list-state"><QueryState error={list.error} retry={() => void list.refetch()} /></div>
          : rows.length ? <ul className="rows mail-rows">
            {rows.map((row) => <li key={row.id} className={'mail-row' + (id === row.id ? ' is-current' : '') + (!row.read ? ' is-unread' : '')}>
              <input type="checkbox" checked={selected.includes(row.id)} disabled={row.sending}
                aria-label={tr('选择', 'Select') + ' ' + (row.subject || tr('无主题', 'No subject'))}
                onChange={(event) => setSelected(event.target.checked ? [...selected, row.id] : selected.filter((item) => item !== row.id))} />
              <button className="mail-row-open" type="button" aria-current={id === row.id ? 'true' : undefined} onClick={() => updateLocation({ message: row.id })}>
                <span className="mail-row-top">
                  <span className="mail-correspondent">{row.folder === 'sent' || row.folder === 'drafts'
                    ? row.to.join(', ') || tr('无收件人', 'No recipients') : row.senderName || row.sender || tr('未知发件人', 'Unknown sender')}</span>
                  <time dateTime={new Date(row.createdAt).toISOString()}><MailDate value={row.createdAt} /></time>
                </span>
                <span className="mail-row-subject"><span>{row.subject || tr('无主题', 'No subject')}</span>{row.hasFiles && <Paperclip size={14} aria-label={tr('有附件', 'Has attachments')} />}</span>
                <small>{row.sending ? tr('等待发送确认', 'Awaiting delivery confirmation') : row.snippet}</small>
              </button>
              <button className={'icon-button mail-star' + (row.starred ? ' starred' : '')} type="button" disabled={action.busy || row.sending}
                aria-pressed={row.starred} aria-label={row.starred ? tr('取消星标', 'Remove star') : tr('添加星标', 'Star message')}
                onClick={() => void changeMessages([row.id], row.starred ? 'unstar' : 'star')}><Star size={17} aria-hidden="true" /></button>
            </li>)}
          </ul> : <div className="mail-empty">
            {query ? <Search size={24} aria-hidden="true" /> : <InboxIcon size={26} aria-hidden="true" />}
            <p>{query ? tr('没有找到匹配的邮件', 'No matching messages') : tr('这里还没有邮件', 'No messages here')}</p>
          </div>}
        {pages > 1 && <div className="mail-paging">
          <button className="icon-button" aria-label={tr('上一页', 'Previous page')} disabled={page <= 1}
            onClick={() => updateLocation({ page: String(page - 1) })}><ArrowLeft size={17} aria-hidden="true" /></button>
          <small>{Math.min(pages, page)} / {pages}</small>
          <button className="icon-button" aria-label={tr('下一页', 'Next page')} disabled={page >= pages}
            onClick={() => updateLocation({ page: String(page + 1) })}><ArrowRight size={17} aria-hidden="true" /></button>
        </div>}
      </section>

      <section className="mail-reader" aria-label={tr('阅读和撰写邮件', 'Read and write mail')}>
        {compose ? <MailCompose address={address} canSend={status.canSend} seed={compose} onClose={() => setCompose(null)} onDone={done} />
          : openDraft ? <MailCompose key={message.id} address={address} canSend={status.canSend} draft={message}
            onClose={() => updateLocation({ message: null })} onDone={done} />
          : message ? <MailReader key={message.id} message={message} address={address} busy={action.busy}
            close={() => updateLocation({ message: null })} update={(operation) => changeMessages([message.id], operation)} compose={setCompose} />
          : id ? <div className="mail-list-state stack">
            <button className="button secondary" onClick={() => updateLocation({ message: null })}><ArrowLeft size={17} aria-hidden="true" />{tr('返回邮件列表', 'Back to messages')}</button>
            <QueryState error={reader.error} retry={() => void reader.refetch()} />
          </div> : <div className="mail-empty mail-reader-empty">
            <MailOpen size={34} aria-hidden="true" /><p>{tr('选择一封邮件阅读', 'Select a message to read')}</p>
          </div>}
      </section>
    </div>
  </div>;
}

function MailDate({ value }: { value: number }) {
  const { lang } = useLocale();
  const date = new Date(value);
  const today = new Date();
  const options: Intl.DateTimeFormatOptions = date.toDateString() === today.toDateString()
    ? { hour: 'numeric', minute: 'numeric' }
    : { month: 'short', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' };
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en', options).format(date);
}

function MailSearch({ query, submit }: { query: string; submit: (value: string) => void }) {
  const { tr } = useLocale();
  const [value, setValue] = useState(query);
  return <form className="mail-search" onSubmit={(event: FormEvent) => { event.preventDefault(); submit(value.trim()); }}>
    <input type="search" value={value} onChange={(event) => setValue(event.target.value)} maxLength={120}
      placeholder={tr('搜索此文件夹', 'Search this folder')} aria-label={tr('搜索此文件夹', 'Search this folder')} />
    <button className="icon-button" title={tr('搜索', 'Search')} aria-label={tr('搜索', 'Search')}><Search size={17} aria-hidden="true" /></button>
  </form>;
}

function BulkActions({ rows, selected, setSelected, folder, apply, busy }: {
  rows: MailSummary[]; selected: string[]; setSelected: (ids: string[]) => void; folder: MailFolder;
  apply: (operation: MailOperation) => void; busy: boolean;
}) {
  const { tr } = useLocale();
  const eligible = rows.filter((row) => !row.sending);
  const all = eligible.length > 0 && selected.length === eligible.length;
  const [confirm, setConfirm] = useState(false);
  return <div className="mail-bulk">
    <label><input type="checkbox" checked={all} disabled={!eligible.length} onChange={() => {
      setConfirm(false);
      setSelected(all ? [] : eligible.map((row) => row.id));
    }} />{selected.length ? selected.length + tr(' 封已选', ' selected') : tr('全选本页', 'Select page')}</label>
    {selected.length > 0 && (folder === 'trash' ? <>
      <button className="icon-button" disabled={busy} title={tr('恢复', 'Restore')} aria-label={tr('恢复', 'Restore')} onClick={() => apply('restore')}><RotateCcw size={16} aria-hidden="true" /></button>
      <button className="icon-button danger-icon" disabled={busy} title={tr('永久删除', 'Delete permanently')} aria-label={tr('永久删除', 'Delete permanently')} onClick={() => setConfirm(true)}><Trash2 size={16} aria-hidden="true" /></button>
    </> : <>
      <button className="icon-button" disabled={busy} title={tr('标为已读', 'Mark as read')} aria-label={tr('标为已读', 'Mark as read')} onClick={() => apply('read')}><MailOpen size={16} aria-hidden="true" /></button>
      {folder === 'inbox' && <button className="icon-button" disabled={busy} title={tr('归档', 'Archive')} aria-label={tr('归档', 'Archive')} onClick={() => apply('archive')}><Archive size={16} aria-hidden="true" /></button>}
      <button className="icon-button danger-icon" disabled={busy} title={tr('移到废纸篓', 'Move to trash')} aria-label={tr('移到废纸篓', 'Move to trash')} onClick={() => apply('trash')}><Trash2 size={16} aria-hidden="true" /></button>
    </>)}
    {confirm && selected.length > 0 && <div className="actions mail-bulk-confirm">
      <button className="button danger" disabled={busy} onClick={() => { setConfirm(false); apply('delete'); }}>{tr('确认永久删除', 'Confirm permanent deletion')}</button>
      <button className="button secondary" onClick={() => setConfirm(false)}>{tr('取消', 'Cancel')}</button>
    </div>}
  </div>;
}
