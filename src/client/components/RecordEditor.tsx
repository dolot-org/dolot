import { useState } from 'react';
import { CAA_TAGS, normalizeRecord, PROXIABLE_TYPES, type RecordInput, type RecordType } from '../../shared/dns';
import { formatMessage } from '../../shared/messages';
import type { DnsRecord, SubdomainDetail } from '../../shared/types';
import { useLocale } from '../lib/preferences';
import { ActionFeedback, Field, formData, textValue, useAction } from './ui';

export function RecordEditor({ detail, existing, save, cancel }: {
  detail: SubdomainDetail; existing?: DnsRecord; save: (record: RecordInput) => Promise<unknown>; cancel: () => void;
}) {
  const { lang, tr } = useLocale();
  const options = detail.root.allowedTypes;
  const [type, setType] = useState<RecordType>(existing?.type ?? options[0] ?? 'A');
  const [proxied, setProxied] = useState(Boolean(existing?.proxied && detail.root.allowProxied));
  const action = useAction();
  const priority = type === 'MX' || type === 'SRV';
  const proxyAllowed = detail.root.allowProxied && PROXIABLE_TYPES.includes(type);
  const contentLabel = type === 'A' ? tr('IPv4 地址', 'IPv4 address') : type === 'AAAA' ? tr('IPv6 地址', 'IPv6 address') : tr('记录值', 'Record value');
  return <form className="inset stack" onSubmit={(event) => {
    const form = formData(event);
    const data: RecordInput = {
      type, host: textValue(form, 'host'), content: textValue(form, 'content'), ttl: proxyAllowed && proxied ? 1 : Number(form.get('ttl')),
      proxied: proxyAllowed && proxied, priority: priority ? Number(form.get('priority')) : null,
      weight: type === 'SRV' ? Number(form.get('weight')) : null, port: type === 'SRV' ? Number(form.get('port')) : null,
      flags: type === 'CAA' ? Number(form.get('flags')) : null, tag: type === 'CAA' ? textValue(form, 'tag') : null,
      comment: textValue(form, 'comment'),
    };
    void action.run(async () => {
      const checked = normalizeRecord(data, detail.subdomain.fqdn, detail.root);
      if (!checked.ok) throw new Error(formatMessage(checked.code, lang, checked.params));
      await save(data);
    });
  }}>
    <div className="form-grid">
      <Field label={tr('类型', 'Type')}><select value={type} onChange={(event) => setType(event.target.value as RecordType)}>
        {existing && !options.includes(existing.type) && <option value={existing.type} disabled>{existing.type}</option>}
        {options.map((option) => <option value={option} key={option}>{option}</option>)}
      </select></Field>
      <Field label={tr('主机名', 'Host')} hint={tr('使用 @ 表示域名本身', 'Use @ for the domain itself')}>
        <input name="host" defaultValue={existing?.host ?? '@'} maxLength={253} autoCapitalize="none" />
      </Field>
      <Field label={contentLabel}>{type === 'TXT'
        ? <textarea name="content" defaultValue={existing?.content ?? ''} required maxLength={2048} rows={3} />
        : <input name="content" defaultValue={existing?.content ?? ''} required maxLength={2048} autoCapitalize="none" />}</Field>
      <Field label={tr('TTL 秒', 'TTL seconds')} hint={tr('1 为自动', '1 for automatic')}>
        <input name="ttl" type="number" min={1} max={86400} required disabled={proxyAllowed && proxied} defaultValue={existing?.ttl ?? 1} />
      </Field>
      {priority && <Field label={tr('优先级', 'Priority')}><input name="priority" type="number" min={0} max={65535} defaultValue={existing?.priority ?? 10} required /></Field>}
      {type === 'SRV' && <>
        <Field label={tr('权重', 'Weight')}><input name="weight" type="number" min={0} max={65535} defaultValue={existing?.weight ?? 0} required /></Field>
        <Field label={tr('端口', 'Port')}><input name="port" type="number" min={0} max={65535} defaultValue={existing?.port ?? 443} required /></Field>
      </>}
      {type === 'CAA' && <>
        <Field label={tr('标志', 'Flags')}><select name="flags" defaultValue={existing?.flags ?? 0}><option value={0}>0</option><option value={128}>128</option></select></Field>
        <Field label={tr('标签', 'Tag')}><select name="tag" defaultValue={existing?.tag ?? 'issue'}>{CAA_TAGS.map((tag) => <option key={tag}>{tag}</option>)}</select></Field>
      </>}
      <Field label={tr('备注', 'Note')}><input name="comment" defaultValue={existing?.comment ?? ''} maxLength={100} /></Field>
    </div>
    {proxyAllowed && <label className="check"><input type="checkbox" checked={proxied} onChange={(event) => setProxied(event.target.checked)} />{tr('启用 Cloudflare 代理', 'Enable Cloudflare proxy')}</label>}
    <div className="actions">
      <button className="button primary" disabled={action.busy}>{tr('保存记录', 'Save record')}</button>
      <button className="button secondary" type="button" disabled={action.busy} onClick={cancel}>{tr('取消', 'Cancel')}</button>
    </div>
    <ActionFeedback action={action} />
  </form>;
}
