import { ArrowLeft, ChevronRight, Globe2, Search } from 'lucide-react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import type { DirectoryDetail, DirectoryDomain } from '../../shared/directory';
import { isHostname } from '../../shared/dns';
import type { Paged } from '../../shared/types';
import { DomainName } from '../components/DomainName';
import { Empty, Field, formData, PageTitle, Panel, QueryState, textValue } from '../components/ui';
import { ApiError, useApiQuery } from '../lib/api';
import { useLocale } from '../lib/preferences';
import { ResolveBox } from './Domains';

export function Directory() {
  const { day, tr } = useLocale();
  const [search, setSearch] = useSearchParams();
  const suffix = search.toString();
  const keyword = search.get('q') ?? '';
  const query = useApiQuery<Paged<DirectoryDomain>>('/directory?' + suffix);
  const data = query.data;
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  function changePage(page: number) {
    const params = new URLSearchParams(search);
    if (page > 1) params.set('page', String(page));
    else params.delete('page');
    setSearch(params);
  }

  return <div className="stack">
    <PageTitle title={tr('域名目录', 'Domain directory')}
      subtitle={tr('浏览已生效的域名和公开 DNS 信息', 'Browse active claimed domains and public DNS information')} />
    <Panel title={tr('已注册域名', 'Claimed domains')}>
      <form className="inline-form" key={keyword} onSubmit={(event) => {
        const value = textValue(formData(event), 'q').trim();
        setSearch(value ? { q: value } : {});
      }}>
        <Field label={tr('域名', 'Domain')}>
          <input type="search" name="q" defaultValue={keyword} maxLength={253} autoCapitalize="none" spellCheck={false} />
        </Field>
        <button className="button secondary"><Search size={17} aria-hidden="true" />{tr('搜索', 'Search')}</button>
      </form>
      {!data ? <QueryState error={query.error} retry={() => void query.refetch()} /> : data.items.length ? <ul className="rows">
        {data.items.map((domain) => <li key={domain.fqdn}>
          <Link className="domain-row" to={{ pathname: '/directory/' + encodeURIComponent(domain.fqdn), search: suffix }}>
            <span className="domain-icon" aria-hidden="true"><Globe2 size={19} /></span>
            <span className="row-main">
              <strong><DomainName name={domain.fqdn} /></strong>
              <small className="muted">{tr('注册于', 'Registered')} {day(domain.registeredAt)}</small>
            </span>
            <ChevronRight size={17} className="muted" aria-hidden="true" />
          </Link>
        </li>)}
      </ul> : <Empty>{data.page > lastPage ? tr('此页无结果', 'No results on this page') : keyword ?
        tr('未找到匹配的域名', 'No matching domains') : tr('暂无已生效的域名', 'No active domains yet')}</Empty>}
      {data && (lastPage > 1 || data.page > 1) && <nav className="actions pagination" aria-label={tr('目录分页', 'Directory pages')}>
        <button className="button secondary" disabled={data.page <= 1}
          onClick={() => changePage(Math.min(lastPage, data.page - 1))}>{tr('上一页', 'Previous')}</button>
        <span className="mono">{data.page} / {lastPage}</span>
        <button className="button secondary" disabled={data.page >= lastPage}
          onClick={() => changePage(data.page + 1)}>{tr('下一页', 'Next')}</button>
      </nav>}
    </Panel>
  </div>;
}

export function DirectoryDomainPage() {
  const { day, tr } = useLocale();
  const { fqdn = '' } = useParams();
  const { search } = useLocation();
  const query = useApiQuery<DirectoryDetail>('/directory/' + encodeURIComponent(fqdn));
  const detail = query.data;
  const lookup = detail && (detail.records.find((record) => record.name === detail.domain.fqdn)
    ?? detail.records.find((record) => isHostname(record.name)));

  return <div className="stack">
    <Link className="back-link" to={{ pathname: '/directory', search }}>
      <ArrowLeft size={16} aria-hidden="true" />{tr('域名目录', 'Domain directory')}
    </Link>
    {detail ? <>
      <PageTitle title={<DomainName name={detail.domain.fqdn} />} />
      <Panel title={tr('公开信息', 'Public information')}>
        <dl className="plate-facts">
          <div><dt>{tr('注册日期', 'Registration date')}</dt><dd>{day(detail.domain.registeredAt)}</dd></div>
          <div><dt>{tr('到期日', 'Expiration date')}</dt>
            <dd>{detail.domain.expiresAt === null ? tr('长期有效', 'No expiration') : day(detail.domain.expiresAt)}</dd></div>
        </dl>
      </Panel>
      <Panel title={tr('已发布的记录名称', 'Published record names')}>
        {detail.records.length ? <ul className="rows">
          {detail.records.map(({ name, type }) => <li className="list-row" key={`${type} ${name}`}>
            <span className="type-tag mono">{type}</span>
            <span className="row-main mono">{name}</span>
          </li>)}
        </ul> : <Empty>{tr('暂无已发布的记录', 'No published records yet')}</Empty>}
      </Panel>
      <ResolveBox key={detail.domain.fqdn} name={lookup?.name ?? detail.domain.fqdn} type={lookup?.type} />
    </> : query.error instanceof ApiError && query.error.status === 404 ?
      <Empty>{tr('此域名不在公开目录中', 'This domain is unavailable in the directory')}</Empty> :
      <QueryState error={query.error} retry={() => void query.refetch()} />}
  </div>;
}
