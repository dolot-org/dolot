import { ArrowLeft, CalendarClock, Clipboard, Download, Globe2, Info, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { RECORD_TYPES, recordValue, zoneLine, type RecordInput } from '../../shared/dns';
import type { ActivityItem, DnsRecord, Me, ResolveResult, RootDomain, Subdomain, SubdomainDetail, TransferPreview, TransferTicket } from '../../shared/types';
import { ClaimBox } from '../components/ClaimBox';
import { DomainName, DomainStatus } from '../components/DomainName';
import { RecordEditor } from '../components/RecordEditor';
import { SuffixList } from '../components/SuffixList';
import { ActionFeedback, ConfirmAction, Empty, Field, formData, Meter, PageTitle, Panel, QueryState, textValue, useAction } from '../components/ui';
import { api, invalidate, useApiQuery, useConfig } from '../lib/api';
import { useLocale } from '../lib/preferences';

const DAY = 86_400_000;

function daysLeft(time: number | null) {
  return time === null ? null : Math.max(0, Math.ceil((time - Date.now()) / DAY));
}

export function Home({ me }: { me: Me }) {
  const { tr } = useLocale();
  const config = useConfig();
  const domains = useApiQuery<Subdomain[]>('/domains', ['domains']);
  const canClaim = me.quota === null || me.used < me.quota;
  const roots = config.data?.roots ?? [];
  const claimLink = <Link className="button primary" to="/claim"><Plus size={18} aria-hidden="true" />{tr('注册域名', 'Claim a domain')}</Link>;
  return <div className="stack">
    <PageTitle title={tr('我的域名', 'My domains')} side={<div className="actions">
      {me.quota !== null && <span className="quota"><span>{tr('账户配额', 'Account quota')}</span><strong className="mono">{me.used} / {me.quota}</strong></span>}
      {canClaim && domains.data?.length ? claimLink : null}
    </div>} />
    {!domains.data ? <QueryState error={domains.error} retry={() => void domains.refetch()} /> : domains.data.length ? <ul className="plates">
      {domains.data.map((domain) => <li key={domain.id}><DomainPlate domain={domain} root={roots.find((root) => root.id === domain.rootId)} /></li>)}
    </ul> : canClaim && roots.length ? <Panel title={tr('注册你的第一个域名', 'Claim your first domain')} className="first-claim">
      <p className="muted">{tr('输入想要的名称 查询可用后即可注册', 'Enter the name you want and claim it once it is available')}</p>
      <ClaimBox roots={roots} canClaim />
    </Panel> : <div className="domain-empty">
      <span className="domain-icon" aria-hidden="true"><Globe2 size={22} /></span>
      <span>{tr('你还没有域名', 'You have no domains yet')}</span>
      {canClaim && claimLink}
    </div>}
    <div className="workspace-tools">
      <TransferIn canReceive={canClaim} />
      <ResolveBox />
    </div>
  </div>;
}

function DomainPlate({ domain, root }: { domain: Subdomain; root?: RootDomain }) {
  const { tr, day } = useLocale();
  const left = daysLeft(domain.expiresAt);
  return <Link className="plate" to={'/domain/' + domain.id}>
    <div className="plate-top">
      <DomainStatus status={domain.status} />
      {domain.note && <span className="plate-note">{domain.note}</span>}
    </div>
    <strong className="plate-name"><DomainName name={domain.fqdn} /></strong>
    <dl className="plate-facts">
      <div><dt>{tr('DNS 记录', 'DNS records')}</dt><dd>{domain.recordCount}{root && <small> / {root.maxRecords}</small>}</dd></div>
      <div><dt>{left === null ? tr('有效期', 'Term') : tr('剩余', 'Remaining')}</dt>
        <dd>{left !== null ? left + tr(' 天', left === 1 ? ' day' : ' days') : domain.status === 'pending' ? tr('审核通过后开始', 'After approval') : tr('长期有效', 'No expiration')}</dd></div>
      {domain.expiresAt !== null && <div><dt>{tr('到期日', 'Expires')}</dt><dd>{day(domain.expiresAt)}</dd></div>}
    </dl>
    {left !== null && root && root.termDays > 0 && <Meter value={left / root.termDays} label={tr('剩余有效期', 'Remaining term')} />}
    <span className="plate-cta">{tr('管理域名', 'Manage domain')}</span>
  </Link>;
}

export function Claim({ roots }: { roots: RootDomain[] }) {
  const { tr } = useLocale();
  const [search] = useSearchParams();
  return <div className="stack">
    <Link to="/home" className="back-link"><ArrowLeft size={16} aria-hidden="true" />{tr('我的域名', 'My domains')}</Link>
    <PageTitle title={tr('注册域名', 'Claim a domain')} subtitle={tr('输入想要的名称或粘贴完整域名', 'Enter a name or paste a full domain')} />
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
      <p className="meta">
        <span>{tr('来自', 'From')} {preview.fromName}</span>
        <span>{preview.recordCount} {tr('条记录', 'records')}</span>
        {preview.expiresAt && <span>{tr('有效期至', 'Expires')} {date(preview.expiresAt)}</span>}
      </p>
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
      {result.answers.map((answer, index) => <li className="list-row answer-row" key={index}>
        <span className="type-tag mono">{answer.type}</span>
        <span className="row-main"><strong className="mono break">{answer.data}</strong><small className="mono break">{answer.name}</small></span>
        <small className="mono">{answer.ttl}s</small>
      </li>)}
    </ul> : <Empty>{tr('未找到记录', 'No records found')} DNS {result.status}</Empty>)}
    <ActionFeedback action={action} />
  </Panel>;
}

export function DomainDetail() {
  const id = useParams().id ?? '';
  return <DomainDetails key={id} id={id} />;
}

function DomainDetails({ id }: { id: string }) {
  const { tr, day } = useLocale();
  const navigate = useNavigate();
  const base = '/domains/' + id;
  const query = useApiQuery<SubdomainDetail>(base, ['domain', id]);
  if (!query.data) return <QueryState error={query.error} retry={() => void query.refetch()} />;
  const detail = query.data;
  const sub = detail.subdomain;
  const left = daysLeft(sub.expiresAt);
  const subtitle = sub.expiresAt === null
    ? sub.status === 'pending' ? tr('审核通过后开始计算有效期', 'The term starts after approval') : tr('长期有效', 'No expiration')
    : left ? <>{tr('有效期至', 'Expires')} {day(sub.expiresAt)}<span className="days-left">{tr(`剩余 ${left} 天`, `${left} ${left === 1 ? 'day' : 'days'} left`)}</span></>
    : tr(`已于 ${day(sub.expiresAt)} 过期`, `Expired ${day(sub.expiresAt)}`);
  return <div className="stack domain-detail">
    <Link to="/home" className="back-link"><ArrowLeft size={16} aria-hidden="true" />{tr('我的域名', 'My domains')}</Link>
    <PageTitle title={<DomainName name={sub.fqdn} />} subtitle={<><DomainStatus status={sub.status} />{subtitle}</>} />
    {sub.statusReason && <p className="notice"><Info size={18} aria-hidden="true" />{sub.statusReason}</p>}
    <div className="detail-grid">
      <div className="stack">
        <RecordList detail={detail} base={base} />
        <ResolveBox name={sub.fqdn} />
      </div>
      <aside className="stack" aria-label={tr('域名设置', 'Domain settings')}>
        <Lifecycle detail={detail} base={base} />
        <Activity base={base} id={id} />
        <Panel title={tr('释放域名', 'Release domain')} className="danger-zone">
          <p className="muted">{tr('释放后会删除全部 DNS 记录 其他人可重新注册', 'Releasing this domain removes all DNS records and makes the name available again')}</p>
          <div><ConfirmAction label={tr('释放域名', 'Release domain')} expected={sub.fqdn} onConfirm={async () => {
            await api(base, 'DELETE', { confirm: sub.fqdn });
            await invalidate('domains', 'me', 'config');
            navigate('/home');
          }} /></div>
        </Panel>
      </aside>
    </div>
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
    <span className="quota"><span>{tr('记录', 'Records')}</span><strong className="mono">{detail.records.length} / {detail.root.maxRecords}</strong></span>
    {detail.records.length > 0 && <button className="button secondary" onClick={download}><Download size={17} aria-hidden="true" />{tr('导出', 'Export')}</button>}
    {canAdd && <button className="button primary" aria-expanded={editor === 'new'} onClick={() => { setEditor(editor === 'new' ? null : 'new'); setRemoving(null); }}>
      <Plus size={17} aria-hidden="true" />{tr('添加记录', 'Add record')}
    </button>}
  </div>}>
    {canAdd && editor === 'new' && showEditor()}
    {detail.records.length ? <div className="records">
      <div className="records-head" aria-hidden="true">
        <span>{tr('类型', 'Type')}</span><span>{tr('主机', 'Host')}</span><span>{tr('记录值', 'Value')}</span><span>{tr('状态', 'Status')}</span><span />
      </div>
      <ul className="rows records-list">
        {detail.records.map((row) => <li key={row.id}>
          <div className={'record-row' + (editor === row.id || removing === row.id ? ' is-open' : '')}>
            <span className="type-tag mono">{row.type}</span>
            <strong className="record-host mono break">{row.host}</strong>
            <span className="record-value">
              <span className="mono break">{recordValue(row)}</span>
              {row.comment && <small>{row.comment}</small>}
            </span>
            <span className="record-meta">
              <span className={'chip ' + (row.published ? 'status-active' : 'status-idle')}>{row.published ? tr('已发布', 'Published') : tr('未发布', 'Unpublished')}</span>
              <small>{row.proxied ? tr('已代理', 'Proxied') : 'TTL ' + (row.ttl === 1 ? tr('自动', 'Auto') : row.ttl)}</small>
            </span>
            {editable && <span className="record-actions">
              <button className="icon-button" type="button" title={tr('编辑', 'Edit')} aria-label={tr('编辑', 'Edit') + ' ' + row.type + ' ' + row.host}
                aria-expanded={editor === row.id} onClick={() => { setEditor(editor === row.id ? null : row.id); setRemoving(null); }}><Pencil size={16} aria-hidden="true" /></button>
              <button className="icon-button danger-icon" type="button" title={tr('删除', 'Delete')} aria-label={tr('删除', 'Delete') + ' ' + row.type + ' ' + row.host}
                aria-expanded={removing === row.id} onClick={() => { setRemoving(removing === row.id ? null : row.id); setEditor(null); }}><Trash2 size={16} aria-hidden="true" /></button>
            </span>}
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
      </ul>
    </div> : editor !== 'new' && <div className="domain-empty">
      <span className="domain-icon" aria-hidden="true"><Plus size={22} /></span>
      <span>{tr('还没有 DNS 记录', 'No DNS records yet')}</span>
      {canAdd && <small>{tr('添加一条 A 或 CNAME 记录 让域名指向你的服务', 'Add an A or CNAME record to point the domain at your service')}</small>}
    </div>}
  </Panel>;
}

function RecordRemoval({ cancel, remove }: { cancel: () => void; remove: () => Promise<void> }) {
  const { tr } = useLocale();
  const action = useAction();
  return <div className="inset stack confirm-box">
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
    {detail.renewable && <div><button className="button primary" disabled={action.busy} onClick={() => void action.run(async () => {
      const result = await api<{ failed: number }>(base + '/renew', 'POST');
      await invalidate('domain', 'domains', 'activity');
      if (result.failed) throw new Error(tr('已续期 部分记录尚未发布', 'Renewed with some DNS records still unpublished'));
    }, tr('域名已续期', 'Domain renewed'))}>{tr('续期', 'Renew domain')}</button></div>}
    {!detail.renewable && detail.renewOpensAt && sub.status === 'active' && <p className="fact"><CalendarClock size={17} aria-hidden="true" /><span>{tr('可续期时间', 'Renewal opens')}<strong>{date(detail.renewOpensAt)}</strong></span></p>}
    {detail.purgeAt && (sub.status === 'expired' || (sub.expiresAt !== null && sub.expiresAt <= Date.now())) && <p className="fact danger-text"><CalendarClock size={17} aria-hidden="true" /><span>{tr('回收时间', 'Release date')}<strong>{date(detail.purgeAt)}</strong></span></p>}
    {transferAllowed && <div className="inset stack">
      <div><h3>{tr('转移域名', 'Transfer domain')}</h3><small>{tr('把转移码交给对方 对方在我的域名页接收', 'Share the code The recipient accepts it from their domains page')}</small></div>
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
    {query.data ? query.data.length ? <ol className="timeline">
      {query.data.map((row) => <li key={row.id}>
        <strong>{activityName(row.action)}</strong>
        <small>{row.actorName || (row.byAdmin ? tr('管理员', 'Administrator') : tr('系统', 'System'))} <time dateTime={new Date(row.createdAt).toISOString()}>{date(row.createdAt)}</time></small>
      </li>)}
    </ol> : <Empty>{tr('暂无动态', 'No activity yet')}</Empty> : <QueryState error={query.error} retry={() => void query.refetch()} />}
  </Panel>;
}
