import { KeyRound, LogOut, Monitor, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Me, PasskeyInfo, SessionInfo } from '../../shared/types';
import { ActionFeedback, ConfirmAction, Empty, Field, formData, PageTitle, Panel, QueryState, textValue, useAction } from '../components/ui';
import { api, invalidate, setMe, useApiQuery } from '../lib/api';
import { addPasskey } from '../lib/passkey';
import { useLocale } from '../lib/preferences';

export function Account({ me }: { me: Me }) {
  const { tr } = useLocale();
  const navigate = useNavigate();
  const action = useAction();
  return <div className="stack">
    <PageTitle title={me.displayName || me.username} subtitle={'@' + me.username + (me.role === 'admin' ? ' ' + tr('管理员', 'Administrator') : '')} side={
      <button className="button secondary" disabled={action.busy} onClick={() => void action.run(async () => {
        await api('/auth/logout', 'POST'); setMe(null); navigate('/', { replace: true });
      })}><LogOut size={17} aria-hidden="true" />{tr('退出登录', 'Sign out')}</button>
    } />
    <div className="split">
    <Panel title={tr('个人资料', 'Profile')}>
      <form className="stack" onSubmit={(event) => {
        const fields = formData(event);
        void action.run(async () => {
          setMe(await api<Me>('/account/profile', 'PATCH', { displayName: textValue(fields, 'displayName'), contact: textValue(fields, 'contact') }));
        }, tr('资料已保存', 'Profile saved'));
      }}>
        <div className="form-grid">
          <Field label={tr('显示名称', 'Display name')}><input name="displayName" maxLength={50} defaultValue={me.displayName} /></Field>
          <Field label={tr('联系方式', 'Contact details')}><input name="contact" maxLength={150} defaultValue={me.contact} /></Field>
        </div>
        <button className="button primary fit" disabled={action.busy}>{tr('保存资料', 'Save profile')}</button>
      </form>
      <ActionFeedback action={action} />
    </Panel>
    <Passkeys />
    </div>
    <Sessions />
    <Panel title={tr('删除账户', 'Delete account')} className="danger-zone">
      <p className="muted">{tr('请先释放或转移所有域名 删除后 Passkey 和登录会话会被清除', 'Release or transfer your domains first Deleting your account removes passkeys and sessions')}</p>
      <div><ConfirmAction label={tr('删除账户', 'Delete account')} expected={me.username} onConfirm={async () => {
        await api('/account', 'DELETE', { confirm: me.username });
        setMe(null);
        navigate('/');
      }} /></div>
    </Panel>
  </div>;
}

function Passkeys() {
  const { tr, date } = useLocale();
  const query = useApiQuery<PasskeyInfo[]>('/account/passkeys', ['passkeys']);
  const action = useAction();
  const [editing, setEditing] = useState<string>();
  const [removing, setRemoving] = useState<PasskeyInfo>();
  const navigate = useNavigate();
  return <Panel title="Passkey" side={<button className="button secondary" disabled={action.busy} onClick={() => void action.run(async () => {
    await addPasskey(); await invalidate('passkeys');
  }, tr('Passkey 已添加', 'Passkey added'))}><KeyRound size={16} aria-hidden="true" />{tr('添加 Passkey', 'Add passkey')}</button>}>
    {query.data ? query.data.length ? <ul className="rows">{query.data.map((row) => <li className="list-row" key={row.id}>
      <span className="row-icon" aria-hidden="true"><KeyRound size={18} /></span>
      <span className="row-main"><strong>{row.name} {row.current && <span className="chip status-active">{tr('当前', 'Current')}</span>}</strong>
        <small className="meta"><span>{tr('上次使用', 'Last used')} {date(row.lastUsedAt)}</span>{row.backedUp && <span>{tr('已同步', 'Synced')}</span>}</small></span>
      <div className="actions">
        <button className="button minor" onClick={() => { setEditing(row.id); setRemoving(undefined); }}>{tr('重命名', 'Rename')}</button>
        <button className="button minor danger" disabled={query.data.length <= 1} onClick={() => { setRemoving(row); setEditing(undefined); }}>{tr('移除', 'Remove')}</button>
      </div>
    </li>)}</ul> : <Empty>{tr('暂无 Passkey', 'No passkeys')}</Empty> : <QueryState error={query.error} retry={() => void query.refetch()} />}
    {editing && <form className="inline-form inset" key={editing} onSubmit={(event) => {
      const name = textValue(formData(event), 'name');
      void action.run(async () => {
        await api('/account/passkeys/' + encodeURIComponent(editing), 'PATCH', { name });
        setEditing(undefined); await invalidate('passkeys');
      });
    }}>
      <Field label={tr('Passkey 名称', 'Passkey name')}><input name="name" required maxLength={50} defaultValue={query.data?.find((r) => r.id === editing)?.name} /></Field>
      <button className="button primary" disabled={action.busy}>{tr('保存', 'Save')}</button>
      <button type="button" className="button secondary" disabled={action.busy} onClick={() => setEditing(undefined)}>{tr('取消', 'Cancel')}</button>
    </form>}
    {removing && <div className="inset stack">
      <p>{tr('移除后将退出使用此 Passkey 的会话', 'Removing this passkey signs out sessions that use it')}</p>
      <div className="actions">
        <button className="button danger" disabled={action.busy} onClick={() => void action.run(async () => {
          await api('/account/passkeys/' + encodeURIComponent(removing.id), 'DELETE');
          setRemoving(undefined);
          if (removing.current) { setMe(null); navigate('/signin'); }
          else await invalidate('passkeys', 'sessions');
        })}>{tr('确认移除', 'Remove passkey')}</button>
        <button className="button secondary" disabled={action.busy} onClick={() => setRemoving(undefined)}>{tr('取消', 'Cancel')}</button>
      </div>
    </div>}
    <ActionFeedback action={action} />
  </Panel>;
}

function Sessions() {
  const { tr, date } = useLocale();
  const query = useApiQuery<SessionInfo[]>('/account/sessions', ['sessions']);
  const action = useAction();
  return <Panel title={tr('登录会话', 'Sessions')}>
    {query.data ? query.data.length ? <ul className="rows">{query.data.map((row) => <li className="list-row" key={row.id}>
      <span className="row-icon" aria-hidden="true">{/Mobile|iPhone|iPad|Android/i.test(row.userAgent) ? <Smartphone size={18} /> : <Monitor size={18} />}</span>
      <div className="row-main">
        <strong>{row.current ? tr('当前会话', 'Current session') : tr('登录于', 'Signed in') + ' ' + date(row.createdAt)}</strong>
        <small className="ellipsis" title={row.userAgent}>{row.userAgent}</small>
        <small className="meta"><span className="mono">{row.ip}</span><span>{tr('最近活动', 'Last active')} {date(row.lastSeenAt)}</span></small>
      </div>
      {!row.current && <button className="button minor danger" disabled={action.busy} onClick={() => void action.run(async () => {
        await api('/account/sessions/' + row.id, 'DELETE');
        await invalidate('sessions');
      }, tr('会话已撤销', 'Session revoked'))}>{tr('撤销', 'Revoke')}</button>}
    </li>)}</ul> : <Empty>{tr('暂无会话', 'No sessions')}</Empty> : <QueryState error={query.error} retry={() => void query.refetch()} />}
    <ActionFeedback action={action} />
  </Panel>;
}
