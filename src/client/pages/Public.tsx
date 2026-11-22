import { Download, Fingerprint, KeyRound, LoaderCircle, Megaphone, Share, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { LEGAL_VERSION } from '../../shared/legal';
import { REPORT_CATEGORIES, type PublicConfig, type ReportCategory } from '../../shared/types';
import { ClaimBox } from '../components/ClaimBox';
import { SuffixList } from '../components/SuffixList';
import { Turnstile } from '../components/Turnstile';
import { ActionFeedback, Empty, Field, formData, Meter, PageTitle, textValue, useAction } from '../components/ui';
import { api, setMe } from '../lib/api';
import { signIn, signUp } from '../lib/passkey';
import { deviceFingerprint } from '../lib/device';
import { install, usePwa } from '../lib/pwa';
import { useLocale } from '../lib/preferences';

export function InstallGate({ next }: { next: string }) {
  const { tr } = useLocale();
  const { canPrompt, standalone } = usePwa();
  const action = useAction();
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return <div className="auth">
    <div className="auth-card">
      <span className="auth-icon" aria-hidden="true"><Download size={26} /></span>
      <div className="auth-text">
        <h1>{tr('安装 Dotlo', 'Install Dotlo')}</h1>
        <p>{tr('从已安装的应用中注册和管理域名', 'Claim and manage domains from the installed app')}</p>
      </div>
      {standalone ? <Link className="button primary wide" to={next}>{tr('打开 Dotlo', 'Open Dotlo')}</Link> : canPrompt
        ? <button className="button primary wide" disabled={action.busy} onClick={() => void action.run(install)}><Download size={18} aria-hidden="true" />{tr('安装应用', 'Install app')}</button>
        : <p className="install-instruction">{ios ? <Share size={19} aria-hidden="true" /> : <Download size={19} aria-hidden="true" />}<span>{ios
          ? tr('用 Safari 打开此页 在分享菜单中选择添加到主屏幕', 'Open this page in Safari and choose Add to Home Screen from the Share menu')
          : tr('使用浏览器菜单中的安装应用或添加到主屏幕功能', 'Choose Install app or Add to Home Screen from your browser menu')}</span></p>}
      {!standalone && <small>{tr('安装后从主屏幕或应用菜单打开 Dotlo', 'After installing, open Dotlo from your home screen or app menu')}</small>}
      <ActionFeedback action={action} />
      <p className="auth-switch"><Link className="text-link" to="/">{tr('返回首页', 'Back to home')}</Link></p>
    </div>
  </div>;
}

export function Welcome({ config, signedIn }: { config: PublicConfig; signedIn: boolean }) {
  const { tr } = useLocale();
  const pwa = usePwa();
  const installRequired = config.requirePwa && !pwa.standalone;
  const remaining = Math.max(0, config.domainCapacity.limit - config.domainCapacity.assigned);
  const primaryPath = signedIn ? '/home' : config.registrationOpen ? '/signup' : '/signin';
  const primaryLabel = signedIn ? tr('管理域名', 'Manage domains')
    : config.registrationOpen ? (installRequired ? tr('安装后注册', 'Install to sign up') : tr('创建账户', 'Create account'))
    : tr('登录', 'Sign in');
  const used = config.domainCapacity.limit ? config.domainCapacity.assigned / config.domainCapacity.limit : 1;
  return <div className="welcome stack">
    <section className="hero" aria-labelledby="welcome-title">
      <div className="hero-top">
        <div className="hero-text">
          <h1 id="welcome-title">{tr('你的域名', 'A domain')}<br />{tr('自由解析', 'of your own')}<span className="hero-dot" aria-hidden="true" /></h1>
          <p>{tr('免费注册子域名 用 Passkey 登录 由 Cloudflare 解析', 'Free subdomains with passkey sign-in and Cloudflare DNS')}</p>
        </div>
        <div className="actions hero-actions">
          <Link className="button light" to={primaryPath}>
            {!signedIn && installRequired && config.registrationOpen && <Download size={17} aria-hidden="true" />}
            {primaryLabel}
          </Link>
          {!signedIn && config.registrationOpen && <Link className="button on-hero" to="/signin"><KeyRound size={17} aria-hidden="true" />{tr('Passkey 登录', 'Passkey sign-in')}</Link>}
        </div>
      </div>
      <div className="hero-lookup">
        <h2 className="sr-only">{tr('查找域名', 'Find a domain')}</h2>
        <ClaimBox roots={config.roots} animate />
      </div>
    </section>
    {config.announcement && <p className="notice" role="status"><Megaphone size={18} aria-hidden="true" />{config.announcement}</p>}
    <dl className="public-stats">
      <div className="stat-capacity">
        <dt>{tr('剩余域名名额', 'Slots remaining')}</dt>
        <dd>{remaining.toLocaleString()}<small>/ {config.domainCapacity.limit.toLocaleString()}</small></dd>
        <Meter value={1 - used} label={tr('剩余名额比例', 'Share of slots remaining')} />
      </div>
      <div><dt>{tr('有效域名', 'Active domains')}</dt><dd>{config.stats.subdomains.toLocaleString()}</dd></div>
      <div><dt>{tr('账户', 'Accounts')}</dt><dd>{config.stats.users.toLocaleString()}</dd></div>
    </dl>
    <SuffixList roots={config.roots} />
  </div>;
}

export function SignIn() {
  const { tr } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const action = useAction();
  const next = (location.state as { next?: string } | null)?.next ?? '/home';
  return <div className="auth">
    <div className="auth-card">
      <span className="auth-icon" aria-hidden="true"><KeyRound size={26} /></span>
      <div className="auth-text">
        <h1>{tr('登录 Dotlo', 'Sign in to Dotlo')}</h1>
        <p>{tr('使用已保存的 Passkey 登录', 'Use a saved passkey to sign in')}</p>
      </div>
      <button className="button primary wide" disabled={action.busy} onClick={() => void action.run(async () => {
        setMe(await signIn());
        navigate(next, { replace: true });
      })}>{action.busy ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <Fingerprint size={18} aria-hidden="true" />}{tr('使用 Passkey 登录', 'Sign in with a passkey')}</button>
      <ActionFeedback action={action} />
      <p className="auth-switch">{tr('还没有账户', 'New to Dotlo')} <Link className="text-link" to="/signup" state={location.state}>{tr('创建账户', 'Create an account')}</Link></p>
    </div>
  </div>;
}

export function SignUp({ config }: { config: PublicConfig }) {
  const { tr } = useLocale();
  const action = useAction();
  const navigate = useNavigate();
  const location = useLocation();
  const [token, setToken] = useState('');
  const [revision, setRevision] = useState(0);
  const [accepted, setAccepted] = useState(false);
  const next = (location.state as { next?: string } | null)?.next ?? '/home';
  return <div className="auth">
    <div className="auth-card">
      <span className="auth-icon" aria-hidden="true"><Fingerprint size={26} /></span>
      <div className="auth-text">
        <h1>{tr('创建账户', 'Create an account')}</h1>
        <p>{tr('使用 Passkey 登录和保护你的域名', 'Use a passkey to sign in and protect your domains')}</p>
      </div>
      {!config.registrationOpen ? <Empty>{tr('暂未开放新账户注册', 'Sign-ups are currently closed')}</Empty> : <form className="stack" onSubmit={(event) => {
        const form = formData(event);
        const legalVersion = textValue(form, 'legalVersion');
        if (legalVersion !== LEGAL_VERSION) return;
        void action.run(async () => {
          try {
            const fingerprint = config.deviceRegistrationCheck ? await deviceFingerprint() : undefined;
            setMe(await signUp({
              username: textValue(form, 'username'), displayName: textValue(form, 'name'), legalVersion, token: token || undefined, fingerprint,
            }));
            navigate(next, { replace: true });
          } finally {
            setRevision((value) => value + 1);
          }
        });
      }}>
        <Field label={tr('用户名', 'Username')} hint={tr('3 到 24 位字母 数字 下划线或连字符', '3 to 24 letters, digits, underscores or hyphens')}>
          <input name="username" required minLength={3} maxLength={24} autoCapitalize="none" autoComplete="username" />
        </Field>
        <Field label={tr('显示名称', 'Display name')}><input name="name" maxLength={50} autoComplete="nickname" placeholder={tr('可选', 'Optional')} /></Field>
        <div className="check consent">
          <input id="legal-consent" type="checkbox" name="legalVersion" value={LEGAL_VERSION} checked={accepted} required
            onChange={(event) => setAccepted(event.target.checked)} aria-labelledby="legal-consent-text" />
          <span id="legal-consent-text">
            <label htmlFor="legal-consent">{tr('我已阅读并同意', 'I have read and agree to the')}</label>{' '}
            <Link className="text-link" to="/agreement" target="_blank" rel="noopener">{tr('用户协议', 'User Agreement')}</Link>{' '}
            {tr('和', 'and')}{' '}
            <Link className="text-link" to="/terms" target="_blank" rel="noopener">{tr('服务条款', 'Terms of Service')}</Link>
          </span>
        </div>
        {config.deviceRegistrationCheck && <small>{tr(
          '本站使用设备指纹防止重复注册', 'Dotlo uses a device fingerprint to prevent duplicate registrations',
        )}</small>}
        <Turnstile siteKey={config.turnstileSiteKey} revision={revision} update={setToken} />
        <button className="button primary wide" disabled={action.busy || !accepted || Boolean(config.turnstileSiteKey && !token)}>
          {action.busy ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <KeyRound size={18} aria-hidden="true" />}{tr('创建 Passkey', 'Create passkey')}
        </button>
        <ActionFeedback action={action} />
      </form>}
      <p className="auth-switch">{tr('已有账户', 'Already registered')} <Link className="text-link" to="/signin" state={location.state}>{tr('登录', 'Sign in')}</Link></p>
    </div>
  </div>;
}

export function useReportCategories() {
  const { tr } = useLocale();
  const names = [tr('钓鱼', 'Phishing'), tr('恶意软件', 'Malware'), tr('垃圾信息', 'Spam'), tr('违法内容', 'Illegal content'), tr('滥用', 'Abuse'), tr('其他', 'Other')];
  return (category: ReportCategory) => names[REPORT_CATEGORIES.indexOf(category)];
}

export function Report({ config }: { config: PublicConfig }) {
  const { tr } = useLocale();
  const action = useAction();
  const categoryName = useReportCategories();
  const [token, setToken] = useState('');
  const [revision, setRevision] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  return <div className="narrow stack">
    <PageTitle title={tr('举报滥用', 'Report abuse')} subtitle={tr('提交涉及 Dotlo 域名的滥用情况', 'Report abuse involving a Dotlo domain')} />
    {submitted ? <div className="notice success" role="status"><ShieldCheck size={20} aria-hidden="true" />{tr('举报已提交', 'Report submitted')}</div> :
      <form className="panel stack" onSubmit={(event) => {
        const fields = formData(event);
        void action.run(async () => {
          try {
            await api('/reports', 'POST', {
              fqdn: textValue(fields, 'fqdn'), category: textValue(fields, 'category'), details: textValue(fields, 'details'),
              contact: textValue(fields, 'contact'), token: token || undefined,
            });
            setSubmitted(true);
          } finally {
            setRevision((value) => value + 1);
          }
        });
      }}>
        <div className="form-grid">
          <Field label={tr('完整域名', 'Full domain name')}><input className="mono" name="fqdn" maxLength={253} autoCapitalize="none" placeholder="name.dotlo.org" required /></Field>
          <Field label={tr('举报类别', 'Category')}><select name="category">{REPORT_CATEGORIES.map((item) => <option key={item} value={item}>{categoryName(item)}</option>)}</select></Field>
        </div>
        <Field label={tr('情况说明', 'Description')}><textarea name="details" minLength={10} maxLength={4000} rows={5} required /></Field>
        <Field label={tr('联系方式', 'Contact details')} hint={tr('可选 便于我们跟进', 'Optional so we can follow up')}><input name="contact" autoComplete="email" maxLength={150} /></Field>
        <Turnstile siteKey={config.turnstileSiteKey} revision={revision} update={setToken} />
        <button className="button primary fit" disabled={action.busy || Boolean(config.turnstileSiteKey && !token)}>{tr('提交举报', 'Submit report')}</button>
        <ActionFeedback action={action} />
      </form>}
    {config.contactEmail && <p className="muted contact-line">{tr('也可以发送邮件至', 'You can also email')} <a className="text-link" href={'mailto:' + config.contactEmail}>{config.contactEmail}</a></p>}
  </div>;
}

export function NotFound() {
  const { tr } = useLocale();
  return <div className="not-found">
    <p className="not-found-code" aria-hidden="true">404<span className="hero-dot" /></p>
    <h1>{tr('页面不存在', 'Page not found')}</h1>
    <p className="muted">{tr('链接可能已失效 或者地址输入有误', 'The link may be outdated or the address mistyped')}</p>
    <Link className="button secondary" to="/">{tr('返回首页', 'Back to home')}</Link>
  </div>;
}
