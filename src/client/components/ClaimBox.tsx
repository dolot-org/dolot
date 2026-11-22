import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Availability, RootDomain, Subdomain } from '../../shared/types';
import { api, invalidate } from '../lib/api';
import { useLocale } from '../lib/preferences';
import { DomainName } from './DomainName';
import { ActionFeedback, Empty, Field, formData, textValue, useAction } from './ui';

export function ClaimBox({ roots, initialLabel = '', initialRoot = '', canClaim = false }: {
  roots: RootDomain[]; initialLabel?: string; initialRoot?: string; canClaim?: boolean;
}) {
  const { tr, date } = useLocale();
  const navigate = useNavigate();
  const [label, setLabel] = useState(initialLabel);
  const [rootId, setRootId] = useState(initialRoot);
  const [checked, setChecked] = useState<{ label: string; rootId: string; value: Availability }>();
  const action = useAction();
  const root = roots.find((item) => item.id === rootId) ?? roots[0];
  const cleanLabel = label.trim().toLowerCase();
  const result = checked && checked.label === cleanLabel && checked.rootId === root?.id ? checked.value : undefined;
  if (!root) return <Empty>{tr('暂时没有开放注册的后缀', 'No domain suffixes are open for registration')}</Empty>;
  const query = new URLSearchParams({ label: cleanLabel, rootId: root.id });
  return <div className="stack">
    <form className="claim-search" onSubmit={(event) => {
      event.preventDefault();
      setChecked(undefined);
      void action.run(async () => {
        const value = await api<Availability>('/domains/check?' + query);
        setChecked({ value, label: cleanLabel, rootId: root.id });
      });
    }}>
      <Field label={tr('域名名称', 'Domain name')}>
        <input className="mono" placeholder="yourname" type="text" maxLength={63} autoCapitalize="none" autoCorrect="off" autoComplete="off" required
          value={label} onChange={(event) => setLabel(event.target.value)} />
      </Field>
      <Field label={tr('域名后缀', 'Domain suffix')}>
        <select className="mono" value={root.id} onChange={(event) => setRootId(event.target.value)}>
          {roots.map((item) => <option value={item.id} key={item.id}>.{item.domain}</option>)}
        </select>
      </Field>
      <button className="button primary" disabled={action.busy}><Search size={17} />{tr('查询域名', 'Check availability')}</button>
    </form>
    <ActionFeedback action={action} />
    {result && <div className="inset stack">
      <div className="section-head">
        <strong><DomainName name={result.fqdn} /></strong>
        <span className={'domain-status ' + (result.available ? 'status-active' : '')}>{result.available ? tr('可注册', 'Available') : result.message}</span>
      </div>
      {result.registeredAt && <small>{tr('注册于', 'Registered')} {date(result.registeredAt)}</small>}
      {result.available && (canClaim ? <form className="stack" onSubmit={(event) => {
        const note = textValue(formData(event), 'note');
        void action.run(async () => {
          const value = await api<Subdomain>('/domains', 'POST', { label: cleanLabel, rootId: root.id, note });
          await invalidate('domains', 'me', 'config');
          navigate('/domain/' + value.id);
        });
      }}>
        <Field label={tr('备注', 'Note')}><input name="note" maxLength={200} /></Field>
        {root.requireReview && <small>{tr('此后缀需要管理员审核', 'This suffix requires approval')}</small>}
        <div><button className="button primary" disabled={action.busy}>{tr('注册域名', 'Claim domain')}</button></div>
      </form> : <Link className="button secondary fit" to={'/claim?' + query}>{tr('登录后注册', 'Sign in to claim')}</Link>)}
    </div>}
  </div>;
}
