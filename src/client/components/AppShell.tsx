import { Globe2, Moon, Shield, Sun, UserRound } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router';
import type { Me } from '../../shared/types';
import { setPreferences, useLocale } from '../lib/preferences';

export function Logo() {
  return <Link className="logo" to="/" aria-label="Dotlo"><span className="logo-mark" aria-hidden="true"><i /></span><span>dotlo<span className="logo-period">.</span></span></Link>;
}

export function AppShell({ me }: { me: Me | null }) {
  const { lang, theme, tr } = useLocale();
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  return <div className="app">
    <a className="skip" href="#main">{tr('跳到内容', 'Skip to content')}</a>
    <header className="topbar">
      <div className="container topbar-inner">
        <Logo />
        {me && <nav className="main-nav" aria-label={tr('主导航', 'Main navigation')}>
          <NavLink to="/home"><Globe2 size={17} />{tr('域名', 'Domains')}</NavLink>
          <NavLink to="/account"><UserRound size={17} />{tr('账户', 'Account')}</NavLink>
          {me.role === 'admin' && <NavLink to="/admin"><Shield size={17} />{tr('管理', 'Admin')}</NavLink>}
        </nav>}
        <div className="top-actions">
          <button className="icon-button lang-button" type="button" onClick={() => setPreferences({ lang: lang === 'zh' ? 'en' : 'zh' })}
            aria-label={tr('切换到英语', 'Switch to Chinese')}>{lang === 'zh' ? 'EN' : '中'}</button>
          <button className="icon-button" type="button" onClick={() => setPreferences({ theme: dark ? 'light' : 'dark' })}
            aria-label={dark ? tr('浅色模式', 'Light mode') : tr('深色模式', 'Dark mode')}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
        </div>
      </div>
    </header>
    <main className="container main" id="main"><Outlet /></main>
    <footer className="container footer">
      <span>Dotlo</span>
      <div><Link to="/terms">{tr('使用条款', 'Terms')}</Link><Link to="/report">{tr('举报滥用', 'Report abuse')}</Link></div>
    </footer>
  </div>;
}
