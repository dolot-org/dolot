import type { RootDomain } from '../../shared/types';
import { useLocale } from '../lib/preferences';
import { Panel } from './ui';

export function SuffixList({ roots }: { roots: RootDomain[] }) {
  const { tr } = useLocale();
  if (!roots.length) return null;
  return <Panel title={tr('可注册后缀', 'Available suffixes')}>
    <ul className="suffix-list">
      {roots.map((root) => <li key={root.id} className="suffix-item">
        <div className="suffix-head">
          <strong className="suffix-name mono">.{root.domain}</strong>
          {root.requireReview && <span className="chip status-pending">{tr('需要审核', 'Approval required')}</span>}
        </div>
        {root.description && <p className="muted">{root.description}</p>}
        <dl className="suffix-facts">
          <div><dt>{tr('记录上限', 'Record limit')}</dt><dd>{root.maxRecords}</dd></div>
          <div><dt>{tr('注册期限', 'Registration term')}</dt><dd>{root.termDays > 0 ? root.termDays + ' ' + tr('天', 'days') : tr('长期有效', 'No expiration')}</dd></div>
          <div><dt>{tr('名称长度', 'Name length')}</dt><dd>{root.minLength}–{root.maxLength}</dd></div>
        </dl>
        <div className="suffix-types" aria-label={tr('支持的记录类型', 'Supported record types')}>
          {root.allowedTypes.map((type) => <span className="type-tag mono" key={type}>{type}</span>)}
        </div>
      </li>)}
    </ul>
  </Panel>;
}
