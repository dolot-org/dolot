import DOMPurify from 'dompurify';
import { Archive, ArrowLeft, Download, Forward, Inbox, Mail, MailOpen, Paperclip, Reply, ReplyAll, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MAIL_BODY_CHARS, MAIL_UPLOAD_BYTES, MAIL_UPLOAD_FILES, type MailDetail, type MailFile, type MailOperation } from '../../shared/mail';
import { api, apiBlob, invalidate } from '../lib/api';
import { useLocale } from '../lib/preferences';
import { ActionFeedback, useAction } from './ui';
import type { ComposeSeed } from './MailCompose';

function cleanMailHtml(html: string) {
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['a', 'b', 'blockquote', 'br', 'caption', 'code', 'dd', 'del', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3', 'h4',
      'h5', 'h6', 'hr', 'i', 'li', 'ol', 'p', 'pre', 's', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody',
      'td', 'th', 'thead', 'tr', 'u', 'ul'],
    ALLOWED_ATTR: ['href', 'title', 'colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:\/\/|mailto:)/i,
  });
  for (const link of fragment.querySelectorAll('a[href]')) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}

function fileURL(message: MailDetail, file: MailFile) {
  return '/mail/messages/' + encodeURIComponent(message.id) + '/files/' + encodeURIComponent(file.id);
}

export function MailReader({ message, address, busy, close, update, compose }: {
  message: MailDetail;
  address: string;
  busy: boolean;
  close: () => void;
  update: (operation: MailOperation) => Promise<unknown>;
  compose: (seed: ComposeSeed) => void;
}) {
  const { tr, date } = useLocale();
  const action = useAction();
  const title = useRef<HTMLHeadingElement>(null);
  const opened = useRef(false);
  const [plain, setPlain] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const html = useMemo(() => cleanMailHtml(message.html), [message.html]);
  const subject = message.subject || tr('无主题', 'No subject');
  const isReceived = message.folder === 'inbox' || message.folder === 'archive';
  const reply = message.replyTo.length ? message.replyTo : message.sender ? [message.sender] : [];
  const additional = [...new Set([...message.to, ...message.cc])].filter((item) =>
    ![address, ...reply].some((excluded) => excluded.toLowerCase() === item.toLowerCase()));

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    title.current?.focus({ preventScroll: true });
    if (isReceived && !message.read) void action.run(async () => {
      await api('/mail/messages', 'PATCH', { ids: [message.id], operation: 'read' });
      await invalidate('mail-list', 'mail-status', 'mail-detail');
    });
  }, [action, isReceived, message.id, message.read]);

  async function download(file: MailFile) {
    const blob = await apiBlob(fileURL(message, file));
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = file.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 5_000);
  }

  function prepare(kind: 'reply' | 'reply-all' | 'forward', withoutFiles = false) {
    const forwarded = kind === 'forward';
    const heading = forwarded ? 'Fwd: ' : 'Re: ';
    const name = message.senderName ? message.senderName + ' <' + message.sender + '>' : message.sender;
    const original = '\n\n' + [
      forwarded ? tr('转发的邮件', 'Forwarded message') : tr('原始邮件', 'Original message'),
      tr('发件人', 'From') + ' ' + name,
      tr('时间', 'Date') + ' ' + date(message.createdAt),
      tr('收件人', 'To') + ' ' + message.to.join(', '),
      tr('主题', 'Subject') + ' ' + subject,
      '', message.body,
    ].join('\n');
    const seed = {
      to: forwarded ? [] : reply.filter((item) => item.toLowerCase() !== address.toLowerCase()),
      cc: kind === 'reply-all' ? additional : [],
      subject: (message.subject.toLowerCase().startsWith(heading.toLowerCase().trim()) ? message.subject : heading + message.subject).slice(0, 500),
      body: original.slice(0, MAIL_BODY_CHARS),
      originalId: forwarded ? undefined : message.id,
    };
    if (!forwarded || withoutFiles || !message.files.length) {
      compose(seed);
      return;
    }
    void action.run(async () => {
      const files = await Promise.all(message.files.map(async (file) =>
        new File([await apiBlob(fileURL(message, file))], file.name, { type: file.type })));
      compose({ ...seed, files });
    });
  }

  const canForwardFiles = message.files.length <= MAIL_UPLOAD_FILES && message.files.reduce((sum, file) => sum + file.size, 0) <= MAIL_UPLOAD_BYTES;

  return <article className="mail-message stack">
    <div className="mail-reader-toolbar">
      <button className="icon-button" title={tr('返回邮件列表', 'Back to messages')} aria-label={tr('返回邮件列表', 'Back to messages')} onClick={close}><ArrowLeft size={20} aria-hidden="true" /></button>
      {!message.sending && <div className="actions">
        {message.folder === 'trash' ? <>
          <button className="icon-button" disabled={busy} aria-label={tr('恢复', 'Restore')} title={tr('恢复', 'Restore')} onClick={() => void update('restore')}><RotateCcw size={18} aria-hidden="true" /></button>
          <button className="icon-button danger-icon" disabled={busy} aria-label={tr('永久删除', 'Delete permanently')} title={tr('永久删除', 'Delete permanently')}
            onClick={() => setConfirm(true)}><Trash2 size={18} aria-hidden="true" /></button>
        </> : <>
          {isReceived && <>
            <button className="icon-button" disabled={busy} aria-label={message.read ? tr('标为未读', 'Mark as unread') : tr('标为已读', 'Mark as read')}
              title={message.read ? tr('标为未读', 'Mark as unread') : tr('标为已读', 'Mark as read')} onClick={() => void update(message.read ? 'unread' : 'read')}>
              {message.read ? <Mail size={18} aria-hidden="true" /> : <MailOpen size={18} aria-hidden="true" />}
            </button>
            <button className="icon-button" disabled={busy} aria-label={message.folder === 'inbox' ? tr('归档', 'Archive') : tr('移到收件箱', 'Move to inbox')}
              title={message.folder === 'inbox' ? tr('归档', 'Archive') : tr('移到收件箱', 'Move to inbox')}
              onClick={() => void update(message.folder === 'inbox' ? 'archive' : 'inbox')}>
              {message.folder === 'inbox' ? <Archive size={18} aria-hidden="true" /> : <Inbox size={18} aria-hidden="true" />}
            </button>
          </>}
          <button className="icon-button danger-icon" disabled={busy} aria-label={tr('移到废纸篓', 'Move to trash')} title={tr('移到废纸篓', 'Move to trash')}
            onClick={() => void update('trash')}><Trash2 size={18} aria-hidden="true" /></button>
        </>}
      </div>}
    </div>
    {confirm && <div className="inset stack"><p>{tr('要永久删除这封邮件吗', 'Permanently delete this message')}</p><div className="actions">
      <button className="button danger" disabled={busy} onClick={() => void update('delete')}>{tr('确认永久删除', 'Confirm permanent deletion')}</button>
      <button className="button secondary" onClick={() => setConfirm(false)}>{tr('取消', 'Cancel')}</button>
    </div></div>}
    <header className="mail-message-head">
      <h2 ref={title} tabIndex={-1}>{subject}</h2>
      <div className="mail-sender">
        <span className="mail-avatar" aria-hidden="true">{Array.from(message.senderName || message.sender)[0]?.toUpperCase() || '?'}</span>
        <div className="mail-person">
          <strong className="break">{message.senderName || message.sender || tr('未知发件人', 'Unknown sender')}</strong>
          {message.senderName && message.sender && <small className="break">{message.sender}</small>}
        </div>
        <time dateTime={new Date(message.createdAt).toISOString()}>{date(message.createdAt)}</time>
      </div>
      <dl className="mail-recipients">
        <div><dt>{tr('收件人', 'To')}</dt><dd>{message.to.join(', ') || address}</dd></div>
        {message.cc.length > 0 && <div><dt>{tr('抄送', 'Cc')}</dt><dd>{message.cc.join(', ')}</dd></div>}
        {message.bcc.length > 0 && <div><dt>{tr('密送', 'Bcc')}</dt><dd>{message.bcc.join(', ')}</dd></div>}
      </dl>
    </header>
    {message.sending && <p className="notice" role="status">{tr('等待发送确认', 'Awaiting delivery confirmation')}</p>}
    {html && message.body && <button className="mail-view-toggle" onClick={() => setPlain(!plain)}>
      {plain ? tr('查看格式化正文', 'Show formatted message') : tr('查看纯文本', 'Show plain text')}
    </button>}
    {html && !plain ? <div className="mail-content mail-html" dangerouslySetInnerHTML={{ __html: html }} />
      : <div className="mail-content mail-plain">{message.body || tr('无正文', 'No message body')}</div>}
    {message.files.length > 0 && <div className="stack">
      <h3>{tr('附件', 'Attachments')}</h3>
      <ul className="mail-attachments rows">
        {message.files.map((file) => <li key={file.id}>
          <Paperclip size={16} aria-hidden="true" /><div className="mail-person"><span className="break">{file.name}</span><small>{Math.max(1, Math.ceil(file.size / 1024))} KB</small></div>
          <button className="icon-button" disabled={action.busy} title={tr('下载附件', 'Download attachment')}
            aria-label={tr('下载附件', 'Download attachment') + ' ' + file.name} onClick={() => void action.run(() => download(file))}><Download size={17} aria-hidden="true" /></button>
        </li>)}
      </ul>
    </div>}
    {(isReceived || message.folder === 'sent') && <div className="actions mail-reply">
      {isReceived && reply.length > 0 && <button className="button secondary" disabled={action.busy} onClick={() => prepare('reply')}><Reply size={17} aria-hidden="true" />{tr('回复', 'Reply')}</button>}
      {isReceived && reply.length > 0 && additional.length > 0 && <button className="button secondary" disabled={action.busy} onClick={() => prepare('reply-all')}><ReplyAll size={17} aria-hidden="true" />{tr('回复全部', 'Reply all')}</button>}
      <button className="button secondary" disabled={action.busy} onClick={() => prepare('forward', !canForwardFiles)}><Forward size={17} aria-hidden="true" />
        {canForwardFiles ? tr('转发', 'Forward') : tr('转发正文', 'Forward text')}</button>
    </div>}
    <ActionFeedback action={action} />
  </article>;
}
