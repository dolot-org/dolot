import { Navigate, Route, Routes, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import type { Me } from '../shared/types';
import { AppShell } from './components/AppShell';
import { QueryState } from './components/ui';
import { useConfig, useMe } from './lib/api';
import { usePwa } from './lib/pwa';
import { Account } from './pages/Account';
import { Admin } from './pages/Admin';
import { Directory, DirectoryDomainPage } from './pages/Directory';
import { Claim, DomainDetail, Home } from './pages/Domains';
import { Inbox } from './pages/Inbox';
import { About, Agreement, Terms } from './pages/Legal';
import { InstallGate, NotFound, Report, SignIn, SignUp, Welcome } from './pages/Public';

function Access({ me, installRequired, role, children }: {
  me: Me | null; installRequired: boolean; role?: 'admin'; children: ReactNode;
}) {
  const location = useLocation();
  const next = location.pathname + location.search;
  if (installRequired) return <InstallGate next={next} />;
  if (!me) return <Navigate replace to="/signin" state={{ next }} />;
  if (role && me.role !== role) return <Navigate replace to="/home" />;
  return children;
}

export function App() {
  const configQuery = useConfig();
  const meQuery = useMe();
  const pwa = usePwa();
  const location = useLocation();
  const config = configQuery.data;
  const me = meQuery.data ?? null;
  const needsInstall = Boolean(config?.requirePwa && !pwa.standalone);
  const information = <>
    <Route path="about" element={<About contact={config?.contactEmail} />} />
    <Route path="agreement" element={<Agreement />} />
    <Route path="terms" element={<Terms />} />
    <Route path="directory" element={<Directory />} />
    <Route path="directory/:fqdn" element={<DirectoryDomainPage />} />
  </>;
  const pending = <QueryState error={configQuery.error ?? meQuery.error} retry={() => {
    if (configQuery.error) void configQuery.refetch();
    if (meQuery.error) void meQuery.refetch();
  }} />;
  if (!config || meQuery.isPending || meQuery.isError) {
    return <Routes><Route element={<AppShell me={null} />}>{information}<Route path="*" element={pending} /></Route></Routes>;
  }
  const authPage = (page: ReactNode) => {
    if (needsInstall) return <InstallGate next={location.pathname} />;
    if (me) return <Navigate to={(location.state as { next?: string } | null)?.next ?? '/home'} replace />;
    return page;
  };
  const signedIn = (page: ReactNode, role?: 'admin') => <Access me={me} installRequired={needsInstall} role={role}>{page}</Access>;
  return <Routes>
    <Route element={<AppShell me={me} />}>
      <Route index element={<Welcome config={config} signedIn={!!me} />} />
      <Route path="install" element={<InstallGate next={me ? '/home' : '/signin'} />} />
      <Route path="signin" element={authPage(<SignIn />)} />
      <Route path="signup" element={authPage(<SignUp config={config} />)} />
      <Route path="home" element={signedIn(me && <Home me={me} />)} />
      <Route path="claim" element={signedIn(<Claim roots={config.roots} />)} />
      <Route path="domain/:id" element={signedIn(<DomainDetail />)} />
      <Route path="mail" element={signedIn(<Inbox />)} />
      <Route path="account" element={signedIn(me && <Account me={me} />)} />
      <Route path="admin/*" element={signedIn(<Admin />, 'admin')} />
      <Route path="report" element={<Report config={config} />} />
      {information}
      <Route path="*" element={<NotFound />} />
    </Route>
  </Routes>;
}
