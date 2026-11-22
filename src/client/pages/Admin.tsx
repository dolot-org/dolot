import { useState, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useParams, useSearchParams } from 'react-router';
import { DEFAULT_ALLOWED_TYPES, RECORD_TYPES, recordValue } from '../../shared/dns';
import {
  SUB_STATUSES, type ActivityItem, type AdminReport, type AdminRoot, type AdminStats, type AdminSubdomain, type AdminUser,
  type CfZoneInfo, type DnsRecord, type Paged, type ReservedName, type SiteSettings, type SyncResult,
} from '../../shared/types';
import { DomainName, DomainStatus, useStatus } from '../components/DomainName';
import { ActionFeedback, ConfirmAction, Empty, Field, formData, PageTitle, Panel, QueryState, textValue, useAction } from '../components/ui';
import { api, invalidate, useApiQuery, useMe } from '../lib/api';
import { useLocale } from '../lib/preferences';
import { useActivityName } from './Domains';
import { NotFound, useReportCategories } from './Public';

export function Admin() {
  const { tr } = useLocale();
  const nav = [
    ['', tr('概览', 'Overview')], ['roots', tr('后缀', 'Suffixes')], ['domains', tr('域名', 'Domains')],
    ['users', tr('账户', 'Accounts')], ['reports', tr('举报', 'Reports')], ['reserved', tr('保留名称', 'Reserved names')],
    ['settings', tr('设置', 'Settings')], ['audit', tr('审计', 'Audit log')],
  ];
  return <div className="stack">
    <nav className="subnav" aria-label={tr('管理导航', 'Admin navigation')}>{nav.map(([path, name]) =>
      <NavLink key={path} to={'/admin' + (path ? '/' + path : '')} end={!path}>{name}</NavLink>)}
    </nav>
    <Routes>
      <Route index element={<Overview />} />
      <Route path="roots" element={<Roots />} />
      <Route path="domains" element={<DomainAdmin />} />
      <Route path="domains/:id" element={<ModerateDomain />} />
      <Route path="users" element={<Users />} />
      <Route path="reports" element={<Reports />} />
      <Route path="reserved" element={<Reserved />} />
      <Route path="settings" element={<Settings />} />
      <Route path="audit" element={<Audit />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </div>;
}

function DomainRows({ items }: { items: AdminSubdomain[] }) {
  const { tr } = useLocale();
  return items.length ? <ul className="rows">
    {items.map((row) => <li key={row.id}>
      <Link className="domain-row" to={'/admin/domains/' + row.id}>
        <span className="row-main"><strong><DomainName name={row.fqdn} /></strong><small>@{row.ownerName}</small></span>
        <DomainStatus status={row.status} /><small>{row.recordCount} {tr('条记录', 'records')}</small>
      </Link>
    </li>)}
  </ul> : <Empty>{tr('暂无域名', 'No domains found')}</Empty>;
}

function Overview() {
  const { tr } = useLocale();
  const statusName = useStatus();
  const stats = useApiQuery<AdminStats>('/admin/stats', ['admin-stats']);
  if (!stats.data) return <QueryState error={stats.error} retry={() => void stats.refetch()} />;
  const data = stats.data;
  const mode = { cloudflare: 'Cloudflare', mock: tr('模拟解析', 'Mock DNS'), unconfigured: tr('解析未配置', 'DNS unconfigured') };
  return <div className="stack">
    <PageTitle title={tr('管理概览', 'Admin overview')} subtitle={mode[data.dnsMode]} />
    <div className="stat-grid">
      <div><strong>{data.users}</strong><span>{tr('账户', 'Accounts')} · +{data.usersWeek} {tr('最近 7 天', 'last 7 days')}</span></div>
      <div><strong>{data.subdomains.active}</strong><span>{tr('有效域名', 'Active domains')} · +{data.subdomainsWeek} {tr('最近 7 天', 'last 7 days')}</span></div>
      <div><strong>{data.records}</strong><span>{tr('DNS 记录', 'DNS records')}</span></div>
      <div><strong>{data.openReports}</strong><span>{tr('待处理举报', 'Open reports')}</span></div>
      <div><strong>{data.roots}</strong><span>{tr('后缀', 'Suffixes')}</span></div>
    </div>
    <Panel title={tr('域名状态', 'Domain statuses')}>
      <div className="actions">{SUB_STATUSES.map((status) => <Link key={status} className="button secondary" to={'/admin/domains?status=' + status}>
        {statusName(status)} <span className="mono">{data.subdomains[status]}</span>
      </Link>)}</div>
    </Panel>
    <Panel title={tr('最近注册', 'Recent claims')}><DomainRows items={data.recent} /></Panel>
  </div>;
}

function PagedList<T>({ path, cache, title, filters, render }: {
  path: string; cache: string; title: string; filters?: ReactNode; render: (items: T[]) => ReactNode;
}) {
  const { tr } = useLocale();
  const [search, setSearch] = useSearchParams();
  const suffix = search.toString();
  const query = useApiQuery<Paged<T>>(path + (suffix ? '?' + suffix : ''), [cache, suffix]);
  const page = query.data?.page ?? 1;
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / (query.data?.pageSize ?? 30)));
  const setPage = (next: number) => {
    const params = new URLSearchParams(search);
    if (next > 1) params.set('page', String(next));
    else params.delete('page');
    setSearch(params);
  };
  return <Panel title={title}>
    {filters}
    {query.data ? render(query.data.items) : <QueryState error={query.error} retry={() => void query.refetch()} />}
    {query.data && (page > 1 || pageCount > 1) && <div className="actions pagination">
      <button className="button secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{tr('上一页', 'Previous')}</button>
      <span className="mono">{page} / {pageCount}</span>
      <button className="button secondary" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>{tr('下一页', 'Next')}</button>
    </div>}
  </Panel>;
}

function Filters({ placeholder, statuses }: { placeholder?: string; statuses?: [string, string][] }) {
  const { tr } = useLocale();
  const [search, setSearch] = useSearchParams();
  return <form className="inline-form" key={search.get('q') + '|' + search.get('status')} onSubmit={(event) => {
    const form = formData(event);
    const params = new URLSearchParams();
    const query = textValue(form, 'q').trim();
    const status = textValue(form, 'status');
    if (query) params.set('q', query);
    if (status) params.set('status', status);
    setSearch(params);
  }}>
    {placeholder && <Field label={placeholder}><input name="q" defaultValue={search.get('q') ?? ''} maxLength={254} /></Field>}
    {statuses && <Field label={tr('状态', 'Status')}>
      <select name="status" defaultValue={search.get('status') ?? ''}>
        <option value="">{tr('全部', 'All')}</option>
        {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </Field>}
    <button className="button secondary">{tr('筛选', 'Filter')}</button>
  </form>;
}

function Roots() {
  const { tr } = useLocale();
  const query = useApiQuery<AdminRoot[]>('/admin/roots', ['admin-roots']);
  const [editing, setEditing] = useState<string>();
  const root = query.data?.find((item) => item.id === editing);
  return <div className="stack">
    <PageTitle title={tr('域名后缀', 'Domain suffixes')} side={<button className="button primary" onClick={() => setEditing('new')}>{tr('添加后缀', 'Add suffix')}</button>} />
    {editing && (root || editing === 'new') && <Panel title={root ? '.' + root.domain : tr('添加后缀', 'Add suffix')}>
      <RootForm key={editing} root={root} close={() => setEditing(undefined)} />
    </Panel>}
    <Panel title={tr('已配置后缀', 'Configured suffixes')}>
      {query.data ? query.data.length ? <ul className="rows">{query.data.map((item) => <li className="list-row" key={item.id}>
        <div className="row-main"><strong className="mono">.{item.domain}</strong><small>{item.description}</small></div>
        <small>{item.status === 'active' ? tr('开放', 'Open') : tr('暂停', 'Paused')} · {item.subdomainCount} {tr('个域名', 'domains')}</small>
        <button className="button minor" onClick={() => setEditing(item.id)}>{tr('编辑', 'Edit')}</button>
      </li>)}</ul> : <Empty>{tr('暂无后缀', 'No suffixes configured')}</Empty> : <QueryState error={query.error} retry={() => void query.refetch()} />}
    </Panel>
  </div>;
}

function RootForm({ root, close }: { root?: AdminRoot; close: () => void }) {
  const { tr } = useLocale();
  const action = useAction();
  const [zones, setZones] = useState<CfZoneInfo[]>();
  const [zoneId, setZoneId] = useState('');
  const [domain, setDomain] = useState('');
  const policy = [
    ['minLength', tr('最短名称', 'Minimum name length'), root?.minLength ?? 3, 1, 63],
    ['maxLength', tr('最长名称', 'Maximum name length'), root?.maxLength ?? 63, 1, 63],
    ['maxRecords', tr('记录上限', 'Maximum records'), root?.maxRecords ?? 20, 1, 50],
    ['termDays', tr('注册期限 天', 'Registration term in days'), root?.termDays ?? 365, 0, 3650],
    ['renewWindowDays', tr('提前续期 天', 'Renewal window in days'), root?.renewWindowDays ?? 30, 1, 3650],
    ['graceDays', tr('过期宽限 天', 'Grace period in days'), root?.graceDays ?? 30, 0, 365],
    ['sort', tr('排序', 'Sort order'), root?.sort ?? 0, -10000, 10000],
  ] as const;
  return <div className="stack">
    {!root && <div className="actions">
      <button className="button secondary" disabled={action.busy} onClick={() => void action.run(async () => setZones(await api<CfZoneInfo[]>('/admin/zones')))}>{tr('读取 Cloudflare 区域', 'Load Cloudflare zones')}</button>
      {zones?.length ? <Field label={tr('Cloudflare 区域', 'Cloudflare zone')}><select value={zones.some((zone) => zone.id === zoneId) ? zoneId : ''} onChange={(event) => {
        const zone = zones.find((option) => option.id === event.target.value);
        if (zone) { setZoneId(zone.id); setDomain(zone.name); }
      }}>
        <option value="">{tr('选择可用区域', 'Choose an available zone')}</option>
        {zones.map((zone) => <option key={zone.id} value={zone.id} disabled={zone.added}>{zone.name} · {zone.status}</option>)}
      </select></Field> : zones && <small>{tr('没有可用区域 可手动填写', 'No zones found Enter the details manually')}</small>}
    </div>}
    <form className="stack" onSubmit={(event) => {
      const form = formData(event);
      const data = {
        ...Object.fromEntries(policy.map(([field]) => [field, Number(form.get(field))])),
        description: textValue(form, 'description'), status: textValue(form, 'status'), allowedTypes: form.getAll('type'),
        allowProxied: form.has('allowProxied'), requireReview: form.has('requireReview'),
        ...(!root ? { zoneId, domain } : {}),
      };
      void action.run(async () => {
        await api('/admin/roots' + (root ? '/' + root.id : ''), root ? 'PATCH' : 'POST', data);
        await invalidate('admin-roots', 'admin-stats', 'config'); close();
      });
    }}>
      <div className="form-grid">
        {!root && <>
          <Field label={tr('域名后缀', 'Domain suffix')}><input className="mono" required value={domain} maxLength={253} onChange={(event) => setDomain(event.target.value)} /></Field>
          <Field label={tr('区域 ID', 'Zone ID')}><input className="mono" required value={zoneId} maxLength={64} onChange={(event) => setZoneId(event.target.value)} /></Field>
        </>}
        <Field label={tr('说明', 'Description')}><input name="description" maxLength={200} defaultValue={root?.description} /></Field>
        <Field label={tr('开放状态', 'Registration status')}><select name="status" defaultValue={root?.status ?? 'active'}>
          <option value="active">{tr('开放', 'Open')}</option><option value="paused">{tr('暂停', 'Paused')}</option>
        </select></Field>
        {policy.map(([field, label, value, min, max]) => <Field key={field} label={label}>
          <input name={field} type="number" defaultValue={value} min={min} max={max} required />
        </Field>)}
      </div>
      <fieldset><legend>{tr('允许的记录类型', 'Allowed DNS record types')}</legend><div className="actions">
        {RECORD_TYPES.map((type) => <label className="check" key={type}><input type="checkbox" name="type" value={type} defaultChecked={(root?.allowedTypes ?? DEFAULT_ALLOWED_TYPES).includes(type)} />{type}</label>)}
      </div></fieldset>
      <div className="actions">
        <label className="check"><input type="checkbox" name="allowProxied" defaultChecked={root?.allowProxied ?? true} />{tr('允许代理', 'Allow proxying')}</label>
        <label className="check"><input type="checkbox" name="requireReview" defaultChecked={root?.requireReview ?? false} />{tr('需要审核', 'Require approval')}</label>
      </div>
      <div className="actions">
        <button className="button primary" disabled={action.busy}>{tr('保存后缀', 'Save suffix')}</button>
        <button className="button secondary" type="button" onClick={close} disabled={action.busy}>{tr('取消', 'Cancel')}</button>
      </div>
    </form>
    <ActionFeedback action={action} />
    {root && <div><ConfirmAction label={tr('删除后缀', 'Delete suffix')} expected={root.domain} onConfirm={async () => {
      await api('/admin/roots/' + root.id, 'DELETE'); await invalidate('admin-roots', 'admin-stats', 'config'); close();
    }} /></div>}
  </div>;
}

function DomainAdmin() {
  const { tr } = useLocale();
  const statusName = useStatus();
  return <PagedList<AdminSubdomain> title={tr('域名管理', 'Manage domains')} path="/admin/subdomains" cache="admin-domains"
    filters={<Filters placeholder={tr('域名', 'Domain')} statuses={SUB_STATUSES.map((status) => [status, statusName(status)])} />}
    render={(items) => <DomainRows items={items} />} />;
}

function ModerateDomain() {
  const { tr, date } = useLocale();
  const { id } = useParams();
  const path = '/admin/subdomains/' + id;
  const query = useApiQuery<{ subdomain: AdminSubdomain; records: DnsRecord[] }>(path, ['admin-domain', id]);
  const action = useAction();
  const [sync, setSync] = useState<SyncResult>();
  const [removed, setRemoved] = useState(false);
  if (removed) return <Panel title={tr('域名已删除', 'Domain removed')}><Link className="text-link fit" to="/admin/domains">{tr('返回域名列表', 'Back to domains')}</Link></Panel>;
  if (!query.data) return <QueryState error={query.error} retry={() => void query.refetch()} />;
  const { subdomain: sub, records } = query.data;
  const refresh = () => invalidate('admin-domain', 'admin-domains', 'admin-stats', 'domain', 'activity', 'admin-audit');
  return <div className="stack">
    <Link className="text-link fit" to="/admin/domains">{tr('域名列表', 'Domain list')}</Link>
    <PageTitle title={sub.fqdn} subtitle={'@' + sub.ownerName + (sub.expiresAt ? ' · ' + date(sub.expiresAt) : '')} side={<DomainStatus status={sub.status} />} />
    <Panel title={tr('域名状态', 'Domain status')}>
      <form className="inline-form" key={sub.status + sub.statusReason} onSubmit={(event) => {
        const fields = formData(event);
        void action.run(async () => {
          const reply = await api<{ failed: number }>(path, 'PATCH', { status: textValue(fields, 'status'), reason: textValue(fields, 'reason') });
          await refresh();
          if (reply.failed) throw new Error(tr('状态已保存 部分记录尚未发布', 'Status saved with some DNS records still unpublished'));
        }, tr('状态已保存', 'Status saved'));
      }}>
        <Field label={tr('状态', 'Status')}><select name="status" defaultValue={sub.status === 'suspended' ? 'suspended' : 'active'}>
          <option value="active">{tr('启用', 'Activate')}</option><option value="suspended">{tr('暂停', 'Suspend')}</option>
        </select></Field>
        <Field label={tr('原因', 'Reason')}><input name="reason" maxLength={250} defaultValue={sub.statusReason} /></Field>
        <button className="button primary" disabled={action.busy}>{tr('保存状态', 'Save status')}</button>
      </form>
      <ActionFeedback action={action} />
    </Panel>
    <Panel title={tr('DNS 记录', 'DNS records')} side={sub.status === 'active' && <button className="button secondary" disabled={action.busy} onClick={() => void action.run(async () => {
      setSync(await api<SyncResult>(path + '/sync', 'POST')); await refresh();
    })}>{tr('同步解析', 'Sync DNS')}</button>}>
      {records.length ? <ul className="rows">{records.map((record) => <li key={record.id} className="list-row">
        <span className="type-tag mono">{record.type}</span><span className="row-main mono break">{record.host} {recordValue(record)}</span>
        <small>{record.published ? tr('已发布', 'Published') : tr('未发布', 'Unpublished')}</small>
      </li>)}</ul> : <Empty>{tr('暂无 DNS 记录', 'No DNS records')}</Empty>}
      {sync && <div className="inset stack">
        <p>{tr('重新发布', 'Republished')} {sync.republished} · {tr('缺失', 'Missing')} {sync.missing} · {tr('外部记录', 'Unmanaged')} {sync.unmanaged.length}</p>
        {sync.unmanaged.map((record, index) => <code className="break" key={index}>{record.type} {record.name} {record.content}</code>)}
      </div>}
    </Panel>
    <Panel title={tr('移除域名', 'Remove domain')}><div><ConfirmAction label={tr('移除域名', 'Remove domain')} expected={sub.fqdn} onConfirm={async () => {
      await api(path, 'DELETE', { confirm: sub.fqdn }); setRemoved(true); await refresh(); await invalidate('config');
    }} /></div></Panel>
  </div>;
}

function Users() {
  const { tr } = useLocale();
  return <PagedList<AdminUser> title={tr('账户管理', 'Manage accounts')} path="/admin/users" cache="admin-users"
    filters={<Filters placeholder={tr('用户名或显示名称', 'Username or display name')} />}
    render={(items) => items.length ? <ul className="rows">{items.map((item) => <UserRow key={item.id} row={item} />)}</ul> : <Empty>{tr('暂无账户', 'No accounts found')}</Empty>} />;
}

function UserRow({ row }: { row: AdminUser }) {
  const { tr, date } = useLocale();
  const me = useMe();
  const action = useAction();
  const [edit, setEdit] = useState(false);
  return <li>
    <div className="list-row">
      <span className="row-main"><strong>@{row.username} {row.displayName}</strong><small>{row.subdomainCount} {tr('个域名', 'domains')} · {row.passkeyCount} Passkey</small></span>
      <small>{row.role === 'admin' ? tr('管理员', 'Administrator') : tr('用户', 'User')} · {row.status === 'banned' ? tr('已停用', 'Banned') : tr('正常', 'Active')}</small>
      <button className="button minor" aria-expanded={edit} onClick={() => setEdit(!edit)}>{edit ? tr('收起', 'Collapse') : tr('编辑', 'Edit')}</button>
    </div>
    {edit && <form className="stack inset" onSubmit={(event) => {
      const fields = formData(event);
      const quota = textValue(fields, 'quota');
      void action.run(async () => {
        await api('/admin/users/' + row.id, 'PATCH', {
          role: fields.get('role') ?? row.role, status: fields.get('status') ?? row.status,
          quota: quota === '' ? null : Number(quota), banReason: textValue(fields, 'banReason'),
        });
        await invalidate('admin-users', 'admin-stats', 'admin-audit', 'me'); setEdit(false);
      });
    }}>
      <small>{tr('注册时间', 'Created')} {date(row.createdAt)} · {tr('最近登录', 'Last signed in')} {date(row.lastLoginAt)} {row.contact && ' · ' + row.contact}</small>
      <div className="form-grid">
        <Field label={tr('角色', 'Role')}><select name="role" defaultValue={row.role} disabled={row.id === me.data?.id}>
          <option value="user">{tr('用户', 'User')}</option><option value="admin">{tr('管理员', 'Administrator')}</option>
        </select></Field>
        <Field label={tr('状态', 'Status')}><select name="status" defaultValue={row.status} disabled={row.id === me.data?.id}>
          <option value="active">{tr('正常', 'Active')}</option><option value="banned">{tr('停用', 'Ban')}</option>
        </select></Field>
        <Field label={tr('专属配额', 'Custom quota')} hint={tr('留空使用默认值', 'Leave empty for the default')}>
          <input name="quota" type="number" min={0} max={1000} defaultValue={row.quota ?? ''} />
        </Field>
        <Field label={tr('停用原因', 'Ban reason')}><input name="banReason" maxLength={200} defaultValue={row.banReason ?? ''} /></Field>
      </div>
      <button className="button primary fit" disabled={action.busy}>{tr('保存账户', 'Save account')}</button>
      <ActionFeedback action={action} />
    </form>}
  </li>;
}

function useReportStatuses(): [AdminReport['status'], string][] {
  const { tr } = useLocale();
  return [['open', tr('待处理', 'Open')], ['resolved', tr('已处理', 'Resolved')], ['dismissed', tr('已驳回', 'Dismissed')]];
}

function Reports() {
  const { tr } = useLocale();
  const statuses = useReportStatuses();
  return <PagedList<AdminReport> title={tr('滥用举报', 'Abuse reports')} path="/admin/reports" cache="admin-reports" filters={<Filters statuses={statuses} />}
    render={(items) => items.length ? <ul className="rows">{items.map((item) => <ReportRow key={item.id} row={item} />)}</ul> : <Empty>{tr('暂无举报', 'No reports found')}</Empty>} />;
}

function ReportRow({ row }: { row: AdminReport }) {
  const { tr, date } = useLocale();
  const categoryName = useReportCategories();
  const statuses = useReportStatuses();
  const action = useAction();
  const [edit, setEdit] = useState(false);
  return <li>
    <div className="list-row">
      <div className="row-main"><strong><DomainName name={row.fqdn} /></strong><small>{categoryName(row.category)} · {date(row.createdAt)}</small></div>
      <small>{statuses.find(([status]) => status === row.status)?.[1]}</small>
      <button className="button minor" aria-expanded={edit} onClick={() => setEdit(!edit)}>{edit ? tr('收起', 'Collapse') : tr('查看举报', 'View report')}</button>
    </div>
    {edit && <form className="stack inset" onSubmit={(event) => {
      const fields = formData(event);
      void action.run(async () => {
        await api('/admin/reports/' + row.id, 'PATCH', { status: textValue(fields, 'status'), resolution: textValue(fields, 'resolution') });
        await invalidate('admin-reports', 'admin-stats', 'admin-audit');
      }, tr('举报已更新', 'Report updated'));
    }}>
      <p className="break multiline">{row.details}</p>
      {row.contact && <small>{tr('联系方式', 'Contact')} {row.contact}</small>}
      {row.handlerName && <small>{tr('处理人', 'Handled by')} {row.handlerName} · {date(row.handledAt)}</small>}
      {row.subdomainId && row.subdomainStatus && <Link className="text-link fit" to={'/admin/domains/' + row.subdomainId}>{tr('管理此域名', 'Manage this domain')}</Link>}
      <div className="form-grid">
        <Field label={tr('处理状态', 'Status')}><select name="status" defaultValue={row.status}>
          {statuses.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
        </select></Field>
        <Field label={tr('处理说明', 'Resolution')}><textarea name="resolution" defaultValue={row.resolution} maxLength={1000} rows={2} /></Field>
      </div>
      <button className="button primary fit" disabled={action.busy}>{tr('保存处理结果', 'Save resolution')}</button>
      <ActionFeedback action={action} />
    </form>}
  </li>;
}

function Reserved() {
  const { tr } = useLocale();
  const action = useAction();
  const [removing, setRemoving] = useState<string>();
  return <div className="stack">
    <Panel title={tr('添加保留名称', 'Add a reserved name')}>
      <form className="inline-form" onSubmit={(event) => {
        const element = event.currentTarget;
        const fields = formData(event);
        void action.run(async () => {
          await api('/admin/reserved', 'POST', { label: textValue(fields, 'label'), reason: textValue(fields, 'reason') });
          element.reset(); await invalidate('admin-reserved', 'admin-audit');
        }, tr('保留名称已保存', 'Reserved name saved'));
      }}>
        <Field label={tr('名称', 'Name')}><input name="label" className="mono" required maxLength={63} /></Field>
        <Field label={tr('原因', 'Reason')}><input name="reason" maxLength={200} /></Field>
        <button className="button primary" disabled={action.busy}>{tr('保存名称', 'Save name')}</button>
      </form>
      <ActionFeedback action={action} />
      {removing && <div className="inset stack">
        <p>{tr('确认移除保留名称', 'Remove reserved name')} <code>{removing}</code></p>
        <div className="actions">
          <button className="button danger" disabled={action.busy} onClick={() => void action.run(async () => {
            await api('/admin/reserved/' + encodeURIComponent(removing), 'DELETE');
            setRemoving(undefined); await invalidate('admin-reserved', 'admin-audit');
          }, tr('保留名称已移除', 'Reserved name removed'))}>{tr('确认移除', 'Remove name')}</button>
          <button className="button secondary" disabled={action.busy} onClick={() => setRemoving(undefined)}>{tr('取消', 'Cancel')}</button>
        </div>
      </div>}
    </Panel>
    <PagedList<ReservedName> title={tr('保留名称', 'Reserved names')} path="/admin/reserved" cache="admin-reserved"
      filters={<Filters placeholder={tr('名称', 'Name')} />} render={(items) => items.length ? <ul className="rows">
        {items.map((item) => <li className="list-row" key={item.label}>
          <span className="row-main"><strong className="mono">{item.label}</strong><small>{item.reason === 'system' ? tr('系统', 'System') : item.reason}</small></span>
          <button className="button minor danger" disabled={action.busy} onClick={() => setRemoving(item.label)}>{tr('移除', 'Remove')}</button>
        </li>)}
      </ul> : <Empty>{tr('暂无保留名称', 'No reserved names found')}</Empty>} />
  </div>;
}

function Settings() {
  const { tr } = useLocale();
  const query = useApiQuery<SiteSettings>('/admin/settings', ['admin-settings']);
  const action = useAction();
  const settings = query.data;
  if (!settings) return <QueryState error={query.error} retry={() => void query.refetch()} />;
  return <Panel title={tr('站点设置', 'Site settings')}>
    <form className="stack" onSubmit={(event) => {
      const fields = formData(event);
      void action.run(async () => {
        await api('/admin/settings', 'PATCH', {
          registrationOpen: fields.has('registrationOpen'), defaultQuota: Number(fields.get('defaultQuota')), dailyClaimLimit: Number(fields.get('dailyClaimLimit')),
          announcement: textValue(fields, 'announcement'), contactEmail: textValue(fields, 'contactEmail'),
        });
        await invalidate('admin-settings', 'admin-audit', 'config', 'me');
      }, tr('设置已保存', 'Settings saved'));
    }}>
      <label className="check"><input type="checkbox" name="registrationOpen" defaultChecked={settings.registrationOpen} />{tr('开放账户注册', 'Allow account registration')}</label>
      <div className="form-grid">
        <Field label={tr('默认域名配额', 'Default domain quota')}><input name="defaultQuota" required type="number" min={0} max={1000} defaultValue={settings.defaultQuota} /></Field>
        <Field label={tr('每日注册上限', 'Daily claim limit')} hint={tr('0 表示不限', '0 for unlimited')}>
          <input name="dailyClaimLimit" required type="number" min={0} max={1000} defaultValue={settings.dailyClaimLimit} />
        </Field>
        <Field label={tr('联系邮箱', 'Contact email')}><input name="contactEmail" type="email" defaultValue={settings.contactEmail} /></Field>
      </div>
      <Field label={tr('公告', 'Announcement')}><textarea name="announcement" maxLength={1000} defaultValue={settings.announcement} rows={3} /></Field>
      <button className="button primary fit" disabled={action.busy}>{tr('保存设置', 'Save settings')}</button>
      <ActionFeedback action={action} />
    </form>
  </Panel>;
}

function Audit() {
  const { tr, date } = useLocale();
  const activityName = useActivityName();
  return <PagedList<ActivityItem> title={tr('审计记录', 'Audit log')} path="/admin/audit" cache="admin-audit"
    filters={<Filters placeholder={tr('操作 对象或账户', 'Action, target or account')} />}
    render={(items) => items.length ? <ul className="rows">{items.map((item) => <li className="list-row" key={item.id}>
      <div className="row-main"><strong>{activityName(item.action)} {item.targetLabel}</strong><small>{item.actorName ?? tr('系统', 'System')} {item.ip && ' · ' + item.ip}</small></div>
      <small>{date(item.createdAt)}</small>
    </li>)}</ul> : <Empty>{tr('暂无审计记录', 'No audit events found')}</Empty>} />;
}
