import { useQuery } from '@tanstack/react-query';
import { LoaderCircle, Mail, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { MailStatus } from '../../shared/mail';
import { cleanHost } from '../../shared/dns';
import type { Availability, RootDomain, Subdomain } from '../../shared/types';
import { api, invalidate } from '../lib/api';
import { useLocale } from '../lib/preferences';
import { DomainName } from './DomainName';
import { ActionFeedback, Empty, ErrorNotice, Field, formData, textValue, useAction } from './ui';

type Lookup = { label: string; rootId: string };

const examples = ['yourname', 'blog', 'mochi', 'studio', 'lab'];

// 首页输入框为空时轮流打出示例名称 聚焦或开启减少动态效果时停在第一个
function useTypedExample(active: boolean) {
  const [text, setText] = useState(examples[0]);
  useEffect(() => {
    if (!active || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let word = 0;
    let chars = examples[0].length;
    let typing = false;
    let timer = 0;
    const tick = () => {
      if (!typing) {
        if (chars > 0) {
          chars -= 1;
          setText(examples[word].slice(0, chars));
          timer = window.setTimeout(tick, 45);
          return;
        }
        word = (word + 1) % examples.length;
        typing = true;
      }
      if (chars < examples[word].length) {
        chars += 1;
        setText(examples[word].slice(0, chars));
        timer = window.setTimeout(tick, 95);
        return;
      }
      typing = false;
      timer = window.setTimeout(tick, 2400);
    };
    timer = window.setTimeout(tick, 2400);
    return () => window.clearTimeout(timer);
  }, [active]);
  return active ? text : examples[0];
}

export function ClaimBox({ roots, initialLabel = '', initialRoot = '', canClaim = false, animate = false }: {
  roots: RootDomain[]; initialLabel?: string; initialRoot?: string; canClaim?: boolean; animate?: boolean;
}) {
  const { lang, tr, date } = useLocale();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState(initialLabel);
  const [rootId, setRootId] = useState(initialRoot);
  const [focused, setFocused] = useState(false);
  const [requested, requestLookup] = useState<Lookup | null>(() =>
    initialLabel && roots.some((root) => root.id === initialRoot) ? { label: cleanHost(initialLabel), rootId: initialRoot } : null,
  );
  const claim = useAction();
  const [mailChecked, setMailChecked] = useState('');
  const mail = useQuery({
    queryKey: ['mail-status'],
    queryFn: ({ signal }) => api<MailStatus>('/mail/status', 'GET', undefined, signal),
    enabled: canClaim,
  });
  const example = useTypedExample(animate && !focused && !label);
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
  const mailAddress = currentRequest && root && !mail.data?.mailbox && mail.data?.domains.includes(root.domain)
    ? currentRequest.label + '@' + root.domain : '';
  const claimMail = !!mailAddress && mailChecked === mailAddress;
  if (!root) return <Empty>{tr('暂时没有开放注册的后缀', 'No domain suffixes are open for registration')}</Empty>;

  // 粘贴完整域名时拆出名称和后缀
  const change = (value: string) => {
    const host = cleanHost(value);
    const matched = roots.find((item) => host.endsWith('.' + item.domain) && host.length > item.domain.length + 1);
    if (matched) {
      setLabel(host.slice(0, -matched.domain.length - 1));
      setRootId(matched.id);
    } else setLabel(value);
  };

  return <div className="claim">
    <form className="address" aria-busy={searching} onSubmit={(event) => {
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
      <div className="address-field" onMouseDown={(event) => {
        if (event.target === event.currentTarget) { event.preventDefault(); input.current?.focus(); }
      }}>
        <span className="address-grow" data-value={label || example}>
          <input ref={input} className="mono" placeholder={example} type="text" maxLength={253} autoCapitalize="none" autoCorrect="off"
            spellCheck={false} autoComplete="off" required disabled={claim.busy} value={label} size={1}
            aria-label={tr('域名名称或完整域名', 'Name or full domain')}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={(event) => change(event.target.value)} />
        </span>
        {roots.length > 1
          ? <select className="address-suffix mono" value={root.id} disabled={claim.busy} aria-label={tr('后缀', 'Suffix')} onChange={(event) => setRootId(event.target.value)}>
            {roots.map((item) => <option value={item.id} key={item.id}>.{item.domain}</option>)}
          </select>
          : <span className="address-suffix mono">.{root.domain}</span>}
      </div>
      <button className="button primary address-go" disabled={searching || claim.busy}>
        {searching ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
        <span>{searching ? tr('正在查询', 'Checking') : tr('查询', 'Check')}</span>
      </button>
    </form>
    {lookup.error && <ErrorNotice message={lookup.error.message} />}
    {result && currentRequest && !searching && !lookup.error && <div className={'claim-result ' + (result.available ? 'is-open' : 'is-taken')}>
      <div className="claim-summary" role="status">
        <span className="claim-signal" aria-hidden="true" />
        <div className="row-main">
          <strong><DomainName name={result.fqdn} /></strong>
          <small>{result.available ? tr('可以注册', 'Available') : result.message}
            {result.registeredAt !== null && <> {tr('注册于', 'Registered')} {date(result.registeredAt)}</>}</small>
        </div>
        {result.available && !canClaim && <Link className="button claim-next" to={'/claim?' + new URLSearchParams(currentRequest)}>
          {tr('继续注册', 'Continue to claim')}
        </Link>}
      </div>
      {result.available && canClaim && <form className="claim-form" onSubmit={(event) => {
        const note = textValue(formData(event), 'note');
        void claim.run(async () => {
          const value = await api<Subdomain>('/domains', 'POST', { ...currentRequest, note, mailbox: claimMail });
          await invalidate('domains', 'me', 'config', 'mail-status');
          navigate(claimMail ? '/mail' : '/domain/' + value.id);
        });
      }}>
        <Field label={tr('备注', 'Note')} hint={root.requireReview ? tr('此后缀需要管理员审核', 'This suffix requires approval') : undefined}>
          <input name="note" maxLength={200} placeholder={tr('可选', 'Optional')} />
        </Field>
        {mailAddress && <label className="claim-mail-option">
          <input type="checkbox" checked={claimMail} disabled={claim.busy} onChange={(event) => setMailChecked(event.target.checked ? mailAddress : '')} />
          <Mail size={17} aria-hidden="true" />
          <span>{tr('同时认领邮箱', 'Also claim email')} <strong className="mono break">{mailAddress}</strong></span>
        </label>}
        <button className="button primary" disabled={claim.busy}>{claim.busy ? tr('正在注册', 'Claiming') : claimMail
          ? tr('认领域名和邮箱', 'Claim domain and email') : tr('注册域名', 'Claim domain')}</button>
      </form>}
      <ActionFeedback action={claim} />
    </div>}
  </div>;
}
