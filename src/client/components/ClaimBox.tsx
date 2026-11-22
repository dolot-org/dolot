import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, LoaderCircle, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { cleanHost } from '../../shared/dns';
import type { Availability, RootDomain, Subdomain } from '../../shared/types';
import { api, invalidate } from '../lib/api';
import { useLocale } from '../lib/preferences';
import { DomainName } from './DomainName';
import { ActionFeedback, Empty, ErrorNotice, Field, formData, textValue, useAction } from './ui';

type Lookup = { label: string; rootId: string };

export function ClaimBox({ roots, initialLabel = '', initialRoot = '', canClaim = false }: {
  roots: RootDomain[]; initialLabel?: string; initialRoot?: string; canClaim?: boolean;
}) {
  const { lang, tr, date } = useLocale();
  const navigate = useNavigate();
  const [label, setLabel] = useState(initialLabel);
  const [rootId, setRootId] = useState(initialRoot);
  const [requested, requestLookup] = useState<Lookup | null>(() =>
    initialLabel && roots.some((root) => root.id === initialRoot) ? { label: cleanHost(initialLabel), rootId: initialRoot } : null,
  );
  const claim = useAction();
  const root = roots.find((item) => item.id === rootId) ?? roots[0];
  const currentRequest = requested && requested.label === cleanHost(label) && requested.rootId === root?.id ? requested : null;
  const lookup = useQuery({
    queryKey: ['domain-availability', lang, currentRequest?.rootId, currentRequest?.label],
    queryFn: ({ signal }) => api<Availability>('/domains/check?' + new URLSearchParams(currentRequest ?? {}), 'GET', undefined, signal),
    enabled: !!currentRequest,
    refetchOnWindowFocus: false,
  });
  const searching = lookup.isFetching;
  const result = lookup.data;
  if (!root) return <Empty>{tr('暂时没有开放注册的后缀', 'No domain suffixes are open for registration')}</Empty>;

  return <div className="stack">
    <form className="claim-search availability-form" aria-busy={searching} onSubmit={(event) => {
      event.preventDefault();
      const value = cleanHost(label);
      if (!value || claim.busy) return;
      const matched = roots.find((item) => value.endsWith('.' + item.domain));
      const next = {
        label: matched ? value.slice(0, -matched.domain.length - 1) : value,
        rootId: matched?.id ?? root.id,
      };
      setLabel(next.label);
      setRootId(next.rootId);
      if (currentRequest && next.label === currentRequest.label && next.rootId === currentRequest.rootId) void lookup.refetch();
      else requestLookup(next);
    }}>
      <Field label={tr('域名名称或完整域名', 'Name or full domain')}>
        <input className="mono" placeholder="yourname" type="text" maxLength={253} autoCapitalize="none" autoCorrect="off"
          spellCheck={false} autoComplete="off" required disabled={claim.busy} value={label} onChange={(event) => setLabel(event.target.value)} />
      </Field>
      {roots.length > 1 ? <Field label={tr('后缀', 'Suffix')}>
        <select className="mono" value={root.id} disabled={claim.busy} onChange={(event) => setRootId(event.target.value)}>
          {roots.map((item) => <option value={item.id} key={item.id}>.{item.domain}</option>)}
        </select>
      </Field> : <div className="field"><span>{tr('后缀', 'Suffix')}</span><span className="fixed-suffix mono">.{root.domain}</span></div>}
      <button className="button primary" disabled={searching || claim.busy}>
        {searching ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}
        {searching ? tr('正在查询', 'Checking') : tr('查询域名', 'Check availability')}
      </button>
    </form>
    {lookup.error && <ErrorNotice message={lookup.error.message} />}
    {result && currentRequest && !searching && !lookup.error && <div className="lookup-result stack">
      <div className="lookup-summary" role="status">
        <span className={'lookup-icon ' + (result.available ? 'status-active' : '')} aria-hidden="true">
          {result.available ? <CircleCheck size={20} /> : <CircleAlert size={20} />}
        </span>
        <div className="row-main">
          <strong><DomainName name={result.fqdn} /></strong>
          <small>{result.available ? tr('可注册', 'Available') : result.message}</small>
          {result.registeredAt !== null && <small>{tr('注册于', 'Registered')} {date(result.registeredAt)}</small>}
        </div>
        {result.available && !canClaim && <Link className="button secondary" to={'/claim?' + new URLSearchParams(currentRequest)}>
          {tr('继续注册', 'Continue to claim')}
        </Link>}
      </div>
      {result.available && canClaim && <form className="stack" onSubmit={(event) => {
        const note = textValue(formData(event), 'note');
        void claim.run(async () => {
          const value = await api<Subdomain>('/domains', 'POST', { ...currentRequest, note });
          await invalidate('domains', 'me', 'config');
          navigate('/domain/' + value.id);
        });
      }}>
        <Field label={tr('备注', 'Note')}><input name="note" maxLength={200} /></Field>
        {root.requireReview && <small>{tr('此后缀需要管理员审核', 'This suffix requires approval')}</small>}
        <button className="button primary fit" disabled={claim.busy}>{claim.busy ? tr('正在注册', 'Claiming') : tr('注册域名', 'Claim domain')}</button>
      </form>}
      <ActionFeedback action={claim} />
    </div>}
  </div>;
}
