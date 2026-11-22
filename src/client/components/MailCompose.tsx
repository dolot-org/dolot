import { Paperclip, Send, X } from 'lucide-react';
import { useState } from 'react';
import { MAIL_BODY_CHARS, MAIL_UPLOAD_BYTES, MAIL_UPLOAD_FILES, type MailDetail, type MailFile } from '../../shared/mail';
import { api, invalidate } from '../lib/api';
import { useLocale } from '../lib/preferences';
import { ActionFeedback, ErrorNotice, Field, useAction } from './ui';

export interface ComposeSeed {
  to?: string[];
  cc?: string[];
  subject?: string;
  body?: string;
  originalId?: string;
  files?: File[];
}

function recipients(value: string) {
  return value.split(/[,;\s]+/).filter(Boolean);
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function MailCompose({ address, canSend, draft, seed, onClose, onDone }: {
  address: string;
  canSend: boolean;
  draft?: MailDetail;
  seed?: ComposeSeed;
  onClose: () => void;
  onDone: (folder: 'drafts' | 'sent') => void;
}) {
  const { tr } = useLocale();
  const [id] = useState(() => draft?.id ?? crypto.randomUUID());
  const [version, setVersion] = useState(draft?.version);
  const [to, setTo] = useState((draft?.to ?? seed?.to ?? []).join(', '));
  const [cc, setCc] = useState((draft?.cc ?? seed?.cc ?? []).join(', '));
  const [bcc, setBcc] = useState(draft?.bcc.join(', ') ?? '');
  const [showCc, setShowCc] = useState(!!(cc || bcc));
  const [subject, setSubject] = useState(draft?.subject ?? seed?.subject ?? '');
  const [body, setBody] = useState(draft?.body ?? seed?.body ?? '');
  const [kept, setKept] = useState<MailFile[]>(draft?.files ?? []);
  const [files, setFiles] = useState<File[]>(seed?.files ?? []);
  const [fileError, setFileError] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [closing, setClosing] = useState(false);
  const action = useAction();

  const save = (send: boolean) => void action.run(async () => {
    const list = recipients(to);
    const copy = recipients(cc);
    const blindCopy = recipients(bcc);
    if (Math.max(list.length, copy.length, blindCopy.length) > 20 || (send && (!list.length && !copy.length && !blindCopy.length))) {
      throw new Error(tr('请输入有效的收件地址 最多 20 个', 'Enter valid email addresses for up to 20 recipients'));
    }
    const path = '/mail/drafts/' + id;
    const saved = await api<MailDetail>(path, 'PUT', {
      to: list, cc: copy, bcc: blindCopy, subject, body, version, originalId: seed?.originalId,
      keep: kept.map((item) => item.id),
      files: await Promise.all(files.map(async (file) => ({
        name: file.name.slice(0, 255), type: file.type, content: await readFile(file),
      }))),
    });
    setVersion(saved.version);
    setKept(saved.files);
    setFiles([]);
    setDirty(false);
    await invalidate('mail-list', 'mail-status', 'mail-detail');
    if (send) {
      await api(path + '/send', 'POST', { version: saved.version });
      await invalidate('mail-list', 'mail-status', 'mail-detail');
    }
    onDone(send ? 'sent' : 'drafts');
  });

  return <form className="mail-compose stack" onChange={() => setDirty(true)} onSubmit={(event) => event.preventDefault()}>
    <div className="mail-reader-toolbar">
      <h2>{draft ? tr('编辑草稿', 'Edit draft') : tr('新邮件', 'New message')}</h2>
      <button type="button" className="icon-button" disabled={action.busy} title={tr('关闭', 'Close')} aria-label={tr('关闭', 'Close')}
        onClick={() => dirty ? setClosing(true) : onClose()}><X size={19} aria-hidden="true" /></button>
    </div>
    {closing && <div className="inset stack">
      <p>{tr('要放弃未保存的更改吗', 'Discard unsaved changes')}</p>
      <div className="actions">
        <button className="button danger" type="button" onClick={onClose}>{tr('放弃更改', 'Discard changes')}</button>
        <button className="button secondary" type="button" onClick={() => setClosing(false)}>{tr('继续编辑', 'Keep editing')}</button>
      </div>
    </div>}
    <div className="mail-from"><span>{tr('发件人', 'From')}</span><strong className="mono break">{address}</strong></div>
    <fieldset className="stack mail-fields" disabled={action.busy}>
      <div className="mail-to">
        <Field label={tr('收件人', 'To')}><input value={to} onChange={(event) => setTo(event.target.value)} autoFocus
          autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder={tr('用逗号分隔地址', 'Separate addresses with commas')} maxLength={5100} /></Field>
        {!showCc && <button className="button secondary" type="button" onClick={() => setShowCc(true)}>{tr('抄送和密送', 'Cc and Bcc')}</button>}
      </div>
      {showCc && <>
        <Field label={tr('抄送', 'Cc')}><input value={cc} onChange={(event) => setCc(event.target.value)} autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={5100} /></Field>
        <Field label={tr('密送', 'Bcc')}><input value={bcc} onChange={(event) => setBcc(event.target.value)} autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={5100} /></Field>
      </>}
      <Field label={tr('主题', 'Subject')}><input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={500} /></Field>
      <Field label={tr('正文', 'Message')}><textarea value={body} onChange={(event) => setBody(event.target.value)} rows={9} maxLength={MAIL_BODY_CHARS} /></Field>
      {(kept.length > 0 || files.length > 0) && <ul className="mail-attachments rows">
        {kept.map((file) => <li key={file.id}>
          <span className="break">{file.name}</span>
          <button type="button" className="icon-button" aria-label={tr('移除附件', 'Remove attachment') + ' ' + file.name}
            onClick={() => { setKept(kept.filter((item) => item.id !== file.id)); setDirty(true); }}><X size={16} aria-hidden="true" /></button>
        </li>)}
        {files.map((file, index) => <li key={index}>
          <span className="break">{file.name}</span>
          <button type="button" className="icon-button" aria-label={tr('移除附件', 'Remove attachment') + ' ' + file.name}
            onClick={() => { setFiles(files.filter((_, i) => i !== index)); setDirty(true); }}><X size={16} aria-hidden="true" /></button>
        </li>)}
      </ul>}
      <div className="actions">
        {canSend ? <button className="button primary" type="button" onClick={() => save(true)}><Send size={17} aria-hidden="true" />{tr('发送', 'Send')}</button>
          : <button className="button primary" type="button" onClick={() => save(false)}>{tr('保存草稿', 'Save draft')}</button>}
        <label className="button secondary mail-upload">
          <Paperclip size={17} aria-hidden="true" />{tr('添加附件', 'Attach files')}
          <input type="file" multiple onChange={(event) => {
            const next = [...files, ...Array.from(event.target.files ?? [])];
            event.target.value = '';
            const tooMany = next.length + kept.length > MAIL_UPLOAD_FILES ||
              [...kept, ...next].reduce((sum, file) => sum + file.size, 0) > MAIL_UPLOAD_BYTES;
            setFileError(tooMany);
            if (!tooMany) setFiles(next);
          }} />
        </label>
        {canSend && <button type="button" className="button secondary" onClick={() => save(false)}>{tr('保存草稿', 'Save draft')}</button>}
      </div>
    </fieldset>
    {!canSend && <p className="muted">{tr('此邮箱暂未开通发信', 'Sending is unavailable for this mailbox')}</p>}
    {fileError && <ErrorNotice message={tr('附件最多 10 个 合计不能超过 4 MB', 'Use up to 10 attachments totaling 4 MB')} />}
    <ActionFeedback action={action} />
  </form>;
}
