import { Clipboard, Download, Globe2, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { RECORD_TYPES, recordValue, zoneLine, type RecordInput } from '../../shared/dns';
import type { ActivityItem, DnsRecord, Me, ResolveResult, RootDomain, Subdomain, SubdomainDetail, TransferPreview, TransferTicket } from '../../shared/types';
import { ClaimBox } from '../components/ClaimBox';
import { DomainName, DomainStatus } from '../components/DomainName';
import { RecordEditor } from '../components/RecordEditor';
import { SuffixList } from '../components/SuffixList';
import { ActionFeedback, ConfirmAction, Empty, Field, formData, PageTitle, Panel, QueryState, textValue, useAction } from '../components/ui';
import { api, invalidate, useApiQuery } from '../lib/api';
import { useLocale } from '../lib/preferences';

export function Home({ me }: { me: Me }) {
  const { tr, date } = useLocale();
  const domains = useApiQuery<Subdomain[]>('/domains', ['domains']);
  const canClaim = me.quota === null || me.used < me.quota;
  const claimLink = <Link className="button primary fit" to="/claim"><Plus size={18} aria-hidden="true" />{tr('注册域名', 'Claim a domain')}</Link>;
  return <div className="stack">
    <PageTitle title={tr('我的域名', 'My domains')} side={canClaim && domains.data?.length ? claimLink : undefined} />
    <Panel title={tr('已分配域名', 'Assigned domains')} side={me.quota !== null &&
      <div className="quota"><span>{tr('账户配额', 'Account quota')}</span><strong className="mono">{me.used} / {me.quota}</strong></div>
    }>
      {!domains.data ? <QueryState error={domains.error} retry={() => void domains.refetch()} /> : domains.data.length ? <ul className="domain-cards">
        {domains.data.map((domain) => <li key={domain.id}>
          <Link className="domain-card" to={'/domain/' + domain.id}>
            <div className="domain-card-heading">
              <span className="domain-icon" aria-hidden="true"><Globe2 size={21} /></span>
              <div className="row-main"><strong><DomainName name={domain.fqdn} /></strong>{domain.note && <small>{domain.note}</small>}</div>
              <DomainStatus status={domain.status} />
            </div>
            <dl className="domain-card-data">
              <div><dt>{tr('DNS 记录', 'DNS records')}</dt><dd className="mono">{domain.recordCount}</dd></div>
              <div><dt>{tr('有效期', 'Valid until')}</dt><dd>{domain.expiresAt ? date(domain.expiresAt) : domain.status === 'pending' ? tr('审核通过后开始', 'After approval') : tr('长期有效', 'No expiration')}</dd></div>
            </dl>
            <span className="text-link">{tr('管理域名', 'Manage domain')}</span>
          </Link>
        </li>)}
      </ul> : <div className="domain-empty">
        <span className="domain-icon" aria-hidden="true"><Globe2 size={23} /></span>
        <span>{tr('你还没有域名', 'You have no domains yet')}</span>
        {canClaim && claimLink}
      </div>}
    </Panel>
    <div className="workspace-tools">
      <TransferIn canReceive={canClaim} />
      <ResolveBox />
    </div>
  </div>;
}

export function Claim({ roots }: { roots: RootDomain[] }) {
  const { tr } = useLocale();
  const [search] = useSearchParams();
  return <div className="stack">
    <PageTitle title={tr('注册域名', 'Claim a domain')} />
    <Panel title={tr('检查名称', 'Check a name')}>
      <ClaimBox key={search.toString()} roots={roots} initialRoot={search.get('rootId') ?? ''} initialLabel={search.get('label') ?? ''} canClaim />
    </Panel>
    <SuffixList roots={roots} />
  </div>;
}

function TransferIn({ canReceive }: { canReceive: boolean }) {
  const { tr, date } = useLocale();
  const action = useAction();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<TransferPreview>();
  if (!canReceive) return <Panel title={tr('接收域名转移', 'Receive a domain transfer')}>
    <Empty>{tr('账户配额已满 释放或转移域名后可接收新域名', 'Your account is at capacity Release or transfer a domain before receiving another')}</Empty>
  </Panel>;
  return <Panel title={tr('接收域名转移', 'Receive a domain transfer')}>
    <form className="inline-form" onSubmit={(event) => {
      event.preventDefault();
      setPreview(undefined);
      void action.run(async () => setPreview(await api<TransferPreview>('/transfers/lookup', 'POST', { code })));
    }}>
      <Field label={tr('转移码', 'Transfer code')}><input className="mono" value={code} maxLength={40} placeholder="xxxx-xxxx-xxxx" required onChange={(event) => {
        setCode(event.target.value);
        setPreview(undefined);
      }} disabled={action.busy} /></Field>
      <button className="button secondary" disabled={action.busy}>{tr('查看转移', 'Look up transfer')}</button>
    </form>
    {preview && <div className="inset stack">
      <strong><DomainName name={preview.fqdn} /></strong>
      <p>{tr('来自', 'From')} {preview.fromName} · {preview.recordCount} {tr('条记录', 'records')}{preview.expiresAt && ' · ' + date(preview.expiresAt)}</p>
      <button className="button primary fit" disabled={action.busy} onClick={() => void action.run(async () => {
        const result = await api<{ id: string }>('/transfers/accept', 'POST', { code });
        await invalidate('domains', 'me');
        navigate('/domain/' + result.id);
      })}>{tr('接收域名', 'Accept domain')}</button>
    </div>}
    <ActionFeedback action={action} />
  </Panel>;
}

function ResolveBox({ name = '' }: { name?: string }) {
  const { tr } = useLocale();
  const [result, setResult] = useState<ResolveResult>();
  const action = useAction();
  return <Panel title={tr('查询 DNS', 'DNS lookup')}>
    <form className="claim-search resolver-form" onSubmit={(event) => {
      const form = formData(event);
      const url = new URLSearchParams({ name: textValue(form, 'name'), type: textValue(form, 'type') });
      setResult(undefined);
      void action.run(async () => setResult(await api<ResolveResult>('/domains/resolve?' + url)));
    }}>
      <Field label={tr('域名', 'Domain')}><input className="mono" name="name" defaultValue={name} maxLength={253} autoCapitalize="none" required /></Field>
      <Field label={tr('记录类型', 'Record type')}><select name="type">{RECORD_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field>
      <button className="button secondary" disabled={action.busy}><Search size={17} />{tr('查询', 'Look up')}</button>
    </form>
    {result && (result.answers.length ? <ul className="rows">
      {result.answers.map((answer, index) => <li className="list-row mono" key={index}>
        <span className="type-tag">{answer.type}</span><span className="row-main break">{answer.name} {answer.data}</span><small>{answer.ttl}s</small>
      </li>)}
    </ul> : <Empty>{tr('未找到记录', 'No records found')} · DNS {result.status}</Empty>)}
    <ActionFeedback action={action} />
  </Panel>;
}

export function DomainDetail() {
  const id = useParams().id ?? '';
  return <DomainDetails key={id} id={id} />;
}

function DomainDetails({ id }: { id: string }) {
  const { tr, date } = useLocale();
  const navigate = useNavigate();
  const base = '/domains/' + id;
  const query = useApiQuery<SubdomainDetail>(base, ['domain', id]);
  if (!query.data) return <QueryState error={query.error} retry={() => void query.refetch()} />;
  const detail = query.data;
  const sub = detail.subdomain;
  return <div className="stack domain-detail">
    <Link to="/home" className="text-link fit">{tr('我的域名', 'My domains')}</Link>
    <PageTitle title={sub.fqdn} subtitle={sub.expiresAt ? tr('有效期至', 'Expires') + ' ' + date(sub.expiresAt) : sub.status === 'pending' ? undefined : tr('长期有效', 'No expiration')}
      side={<DomainStatus status={sub.status} />} />
    {sub.statusReason && <p className="notice">{sub.statusReason}</p>}
    <RecordList detail={detail} base={base} />
    <ResolveBox name={sub.fqdn} />
    <Lifecycle detail={detail} base={base} />
    <Activity base={base} id={id} />
    <Panel title={tr('释放域名', 'Release domain')}>
      <p className="muted">{tr('释放后会删除全部 DNS 记录 其他人可重新注册', 'Releasing this domain removes all DNS records and makes the name available again')}</p>
      <div><ConfirmAction label={tr('释放域名', 'Release domain')} expected={sub.fqdn} onConfirm={async () => {
        await api(base, 'DELETE', { confirm: sub.fqdn });
        await invalidate('domains', 'me', 'config');
        navigate('/home');
      }} /></div>
    </Panel>
  </div>;
}

function RecordList({ detail, base }: { detail: SubdomainDetail; base: string }) {
  const { tr } = useLocale();
  const [editor, setEditor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const inlinePanel = useRef<HTMLDivElement>(null);
  const active = detail.subdomain.status === 'active' && (detail.subdomain.expiresAt === null || detail.subdomain.expiresAt > Date.now());
  const editable = active || detail.subdomain.status === 'pending';
  const canAdd = editable && detail.records.length < detail.root.maxRecords && detail.root.allowedTypes.length > 0;

  useEffect(() => {
    if (editor || removing) inlinePanel.current?.focus();
  }, [editor, removing]);

  function download() {
    const zone = detail.records.map(zoneLine).join('\n') + '\n';
    const url = URL.createObjectURL(new Blob([zone], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = detail.subdomain.fqdn + '.zone';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function showEditor(record?: DnsRecord) {
    const save = async (data: RecordInput) => {
      await api(base + '/records' + (record ? '/' + record.id : ''), record ? 'PATCH' : 'POST', data);
      setEditor(null);
      await invalidate('domain', 'domains', 'activity');
    };
    return <div className="record-inline" ref={inlinePanel} tabIndex={-1}>
      <RecordEditor detail={detail} existing={record} cancel={() => setEditor(null)} save={save} />
    </div>;
  }

  return <Panel title={tr('DNS 记录', 'DNS records')} side={<div className="actions">
    <div className="quota"><span>{tr('记录上限', 'Record limit')}</span><strong className="mono">{detail.records.length} / {detail.root.maxRecords}</strong></div>
    {detail.records.length > 0 && <button className="button secondary" onClick={download}><Download size={17} aria-hidden="true" />{tr('导出', 'Export')}</button>}
    {canAdd && <button className="button primary" aria-expanded={editor === 'new'} onClick={() => { setEditor('new'); setRemoving(null); }}>
      <Plus size={17} aria-hidden="true" />{tr('添加记录', 'Add record')}
    </button>}
  </div>}>
    {canAdd && editor === 'new' && showEditor()}
    {detail.records.length ? <ul className="rows records-list">
      {detail.records.map((row) => <li key={row.id}>
        <div className="list-row record-row">
          <span className="type-tag mono">{row.type}</span>
          <div className="row-main">
            <strong className="mono break">{row.host}</strong>
            <span className="mono break">{recordValue(row)}</span>
            {row.comment && <small>{row.comment}</small>}
          </div>
          <div className="record-meta">
            <span className={'domain-status ' + (row.published ? 'status-active' : '')}>{row.published ? tr('已发布', 'Published') : tr('未发布', 'Unpublished')}</span>
            <small>{row.proxied ? tr('已代理', 'Proxied') : 'TTL ' + (row.ttl === 1 ? tr('自动', 'Auto') : row.ttl)}</small>
          </div>
          {editable && <div className="actions record-actions">
            <button className="button minor" aria-expanded={editor === row.id} onClick={() => { setEditor(row.id); setRemoving(null); }}>{tr('编辑', 'Edit')}</button>
            <button className="button minor danger" aria-expanded={removing === row.id} onClick={() => { setRemoving(row.id); setEditor(null); }}>{tr('删除', 'Delete')}</button>
          </div>}
        </div>
        {editable && editor === row.id && showEditor(row)}
        {editable && removing === row.id && <div className="record-inline" ref={inlinePanel} tabIndex={-1}>
          <RecordRemoval cancel={() => setRemoving(null)} remove={async () => {
            await api(base + '/records/' + row.id, 'DELETE');
            setRemoving(null);
            await invalidate('domain', 'domains', 'activity');
          }} />
        </div>}
      </li>)}
    </ul> : editor !== 'new' && <Empty>{tr('还没有 DNS 记录', 'No DNS records yet')}</Empty>}
  </Panel>;
}

function RecordRemoval({ cancel, remove }: { cancel: () => void; remove: () => Promise<void> }) {
  const { tr } = useLocale();
  const action = useAction();
  return <div className="inset stack">
    <p>{tr('确认删除这条 DNS 记录', 'Delete this DNS record')}</p>
    <div className="actions">
      <button className="button danger" disabled={action.busy} onClick={() => void action.run(remove)}>{tr('确认删除', 'Delete record')}</button>
      <button className="button secondary" disabled={action.busy} onClick={cancel}>{tr('取消', 'Cancel')}</button>
    </div>
    <ActionFeedback action={action} />
  </div>;
}

function Lifecycle({ detail, base }: { detail: SubdomainDetail; base: string }) {
  const { tr, date } = useLocale();
  const [ticket, setTicket] = useState<TransferTicket>();
  const action = useAction();
  const sub = detail.subdomain;
  const transferAllowed = sub.status === 'active' && (sub.expiresAt === null || sub.expiresAt > Date.now());
  return <Panel title={tr('域名设置', 'Domain settings')}>
    <form className="inline-form" key={sub.note} onSubmit={(event) => {
      const note = textValue(formData(event), 'note');
      void action.run(async () => { await api(base, 'PATCH', { note }); await invalidate('domain', 'domains', 'activity'); }, tr('备注已保存', 'Note saved'));
    }}>
      <Field label={tr('备注', 'Note')}><input name="note" maxLength={200} defaultValue={sub.note} /></Field>
      <button className="button secondary" disabled={action.busy}>{tr('保存备注', 'Save note')}</button>
    </form>
    {detail.renewable && <div><button className="button secondary" disabled={action.busy} onClick={() => void action.run(async () => {
      const result = await api<{ failed: number }>(base + '/renew', 'POST');
      await invalidate('domain', 'domains', 'activity');
      if (result.failed) throw new Error(tr('已续期 部分记录尚未发布', 'Renewed with some DNS records still unpublished'));
    }, tr('域名已续期', 'Domain renewed'))}>{tr('续期', 'Renew domain')}</button></div>}
    {!detail.renewable && detail.renewOpensAt && sub.status === 'active' && <small>{tr('可续期时间', 'Renewal opens')} {date(detail.renewOpensAt)}</small>}
    {detail.purgeAt && (sub.status === 'expired' || (sub.expiresAt !== null && sub.expiresAt <= Date.now())) && <small>{tr('回收时间', 'Release date')} {date(detail.purgeAt)}</small>}
    {transferAllowed && <div className="inset stack">
      <h3>{tr('转移域名', 'Transfer domain')}</h3>
      {ticket && ticket.expiresAt > Date.now() && <div className="actions"><code className="transfer-code">{ticket.code}</code>
        <button className="button secondary" onClick={() => void action.run(() => navigator.clipboard.writeText(ticket.code), tr('已复制', 'Copied'))}><Clipboard size={16} />{tr('复制转移码', 'Copy code')}</button>
      </div>}
      {sub.transferExpiresAt && <small>{tr('转移码有效期至', 'Transfer code expires')} {date(sub.transferExpiresAt)}</small>}
      <div className="actions">
        <button className="button secondary" disabled={action.busy} onClick={() => void action.run(async () => {
          setTicket(await api<TransferTicket>(base + '/transfer', 'POST'));
          await invalidate('domain', 'activity');
        })}>{sub.transferExpiresAt ? tr('生成新转移码', 'Generate new code') : tr('生成转移码', 'Generate transfer code')}</button>
        {sub.transferExpiresAt && <button className="button secondary" disabled={action.busy} onClick={() => void action.run(async () => {
          await api(base + '/transfer', 'DELETE'); setTicket(undefined); await invalidate('domain', 'activity');
        }, tr('转移已取消', 'Transfer cancelled'))}>{tr('取消转移', 'Cancel transfer')}</button>}
      </div>
    </div>}
    <ActionFeedback action={action} />
  </Panel>;
}

export function useActivityName() {
  const { tr } = useLocale();
  const names: Record<string, string> = {
    'subdomain.claim': tr('注册域名', 'Domain claimed'), 'subdomain.renew': tr('续期', 'Domain renewed'),
    'subdomain.expire': tr('域名过期', 'Domain expired'), 'subdomain.purge': tr('过期域名回收', 'Expired domain released'),
    'subdomain.release': tr('释放域名', 'Domain released'), 'subdomain.remove': tr('管理员移除域名', 'Domain removed'),
    'subdomain.active': tr('启用域名', 'Domain activated'), 'subdomain.suspended': tr('暂停域名', 'Domain suspended'),
    'subdomain.note': tr('更新备注', 'Note updated'), 'subdomain.sync': tr('同步解析', 'DNS synced'),
    'subdomain.transfer.create': tr('生成转移码', 'Transfer code created'), 'subdomain.transfer.cancel': tr('取消转移', 'Transfer cancelled'),
    'subdomain.transfer.accept': tr('完成转移', 'Transfer accepted'),
    'record.create': tr('添加记录', 'Record added'), 'record.update': tr('编辑记录', 'Record edited'), 'record.delete': tr('删除记录', 'Record deleted'),
    'account.register': tr('创建账户', 'Account created'), 'account.delete': tr('删除账户', 'Account deleted'),
    'root.create': tr('添加后缀', 'Suffix added'), 'root.update': tr('更新后缀', 'Suffix updated'), 'root.delete': tr('删除后缀', 'Suffix removed'),
    'user.update': tr('更新账户', 'Account updated'), 'report.open': tr('重新打开举报', 'Report reopened'),
    'report.resolved': tr('处理举报', 'Report resolved'), 'report.dismissed': tr('驳回举报', 'Report dismissed'),
    'reserved.save': tr('保存保留名称', 'Reserved name saved'), 'reserved.delete': tr('移除保留名称', 'Reserved name removed'),
    'settings.update': tr('更新站点设置', 'Site settings updated'),
  };
  return (action: string) => names[action] ?? action;
}

function Activity({ base, id }: { base: string; id: string }) {
  const { tr, date } = useLocale();
  const activityName = useActivityName();
  const query = useApiQuery<ActivityItem[]>(base + '/activity', ['activity', id]);
  return <Panel title={tr('域名动态', 'Domain activity')}>
    {query.data ? query.data.length ? <ul className="rows">
      {query.data.map((row) => <li className="list-row" key={row.id}>
        <span className="row-main"><strong>{activityName(row.action)}</strong><small>{row.actorName || (row.byAdmin ? tr('管理员', 'Administrator') : tr('系统', 'System'))}</small></span>
        <small>{date(row.createdAt)}</small>
      </li>)}
    </ul> : <Empty>{tr('暂无动态', 'No activity yet')}</Empty> : <QueryState error={query.error} retry={() => void query.refetch()} />}
  </Panel>;
}
