import { Globe2, Moon, Shield, Sun, UserRound } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigationType } from 'react-router';
import type { Me } from '../../shared/types';
import { setPreferences, useLocale } from '../lib/preferences';
import { source } from '../lib/source';

export function Logo() {
  return <Link className="logo" to="/" aria-label="Dotlo"><span className="logo-mark" aria-hidden="true"><i /></span><span>dotlo<span className="logo-period">.</span></span></Link>;
}

function NavLinks({ me }: { me: Me }) {
  const { tr } = useLocale();
  const { pathname } = useLocation();
  const domainSection = pathname === '/home' || pathname === '/claim' || pathname.startsWith('/domain/');
  return <>
    <Link to="/home" className={domainSection ? 'active' : undefined}
      aria-current={pathname === '/home' ? 'page' : domainSection ? 'location' : undefined}><Globe2 size={18} aria-hidden="true" /><span>{tr('域名', 'Domains')}</span></Link>
    <NavLink to="/account"><UserRound size={18} aria-hidden="true" /><span>{tr('账户', 'Account')}</span></NavLink>
    {me.role === 'admin' && <NavLink to="/admin"><Shield size={18} aria-hidden="true" /><span>{tr('管理', 'Admin')}</span></NavLink>}
  </>;
}

export function AppShell({ me }: { me: Me | null }) {
  const { lang, theme, tr } = useLocale();
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const main = useRef<HTMLElement>(null);
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    if (navigationType === 'POP') return;
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [pathname, navigationType]);
  return <div className={'app' + (me ? ' has-tabbar' : '')}>
    <a className="skip" href="#main">{tr('跳到内容', 'Skip to content')}</a>
    <header className="topbar">
      <div className="container topbar-inner">
        <Logo />
        {me && <nav className="main-nav" aria-label={tr('主导航', 'Main navigation')}><NavLinks me={me} /></nav>}
        <div className="top-actions">
          <button className="icon-button lang-button" type="button" onClick={() => setPreferences({ lang: lang === 'zh' ? 'en' : 'zh' })}
            aria-label={tr('切换到英语', 'Switch to Chinese')}>{lang === 'zh' ? 'EN' : '中'}</button>
          <button className="icon-button" type="button" onClick={() => setPreferences({ theme: dark ? 'light' : 'dark' })}
            aria-label={dark ? tr('浅色模式', 'Light mode') : tr('深色模式', 'Dark mode')}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
        </div>
      </div>
    </header>
    <main className="container main" id="main" tabIndex={-1} ref={main}><Outlet /></main>
    <footer className="container footer">
      <div className="footer-brand">
        <span className="logo-mark small" aria-hidden="true"><i /></span>
        <span>{tr('Dotlo 公益二级域名', 'Dotlo free subdomains')}</span>
      </div>
      <nav aria-label={tr('站点信息', 'Site information')}>
        <Link to="/about">{tr('关于', 'About')}</Link>
        <a className="source-link" href={source.archive}>{tr('下载对应源码', 'Download corresponding source')}</a>
        <Link to="/agreement">{tr('用户协议', 'User Agreement')}</Link>
        <Link to="/terms">{tr('服务条款', 'Terms of Service')}</Link>
        <Link to="/report">{tr('举报滥用', 'Report abuse')}</Link>
      </nav>
    </footer>
    {me && <nav className="tabbar" aria-label={tr('主导航', 'Main navigation')}><NavLinks me={me} /></nav>}
  </div>;
}
