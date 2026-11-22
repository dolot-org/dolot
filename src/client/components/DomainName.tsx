import { SUB_STATUSES, type SubStatus } from '../../shared/types';
import { useLocale } from '../lib/preferences';

export function DomainName({ name }: { name: string }) {
  const dot = name.indexOf('.');
  return <span className="domain-name">{dot === -1 ? name : <>{name.slice(0, dot)}<span className="domain-suffix">{name.slice(dot)}</span></>}</span>;
}

export function useStatus() {
  const { tr } = useLocale();
  const names = [tr('有效', 'Active'), tr('待审核', 'Pending'), tr('已暂停', 'Suspended'), tr('已过期', 'Expired')];
  return (status: SubStatus) => names[SUB_STATUSES.indexOf(status)];
}

export function DomainStatus({ status }: { status: SubStatus }) {
  const statusName = useStatus();
  return <span className={'domain-status status-' + status}><span aria-hidden="true" />{statusName(status)}</span>;
}
