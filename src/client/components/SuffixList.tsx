import { Globe2 } from 'lucide-react';
import type { RootDomain } from '../../shared/types';
import { useLocale } from '../lib/preferences';
import { Panel } from './ui';

export function SuffixList({ roots }: { roots: RootDomain[] }) {
  const { tr } = useLocale();
  if (!roots.length) return null;
  return <Panel title={tr('可注册后缀', 'Available suffixes')}>
    <ul className="suffix-list">
      {roots.map((root) => <li key={root.id} className="suffix-item">
        <span className="domain-icon" aria-hidden="true"><Globe2 size={20} /></span>
        <div className="row-main">
          <strong className="mono">.{root.domain}</strong>
          {root.description && <p className="muted">{root.description}</p>}
          <div className="suffix-types" aria-label={tr('支持的记录类型', 'Supported record types')}>
            {root.allowedTypes.map((type) => <span className="type-tag mono" key={type}>{type}</span>)}
          </div>
        </div>
        <dl className="suffix-limits">
          <div><dt>{tr('记录上限', 'Record limit')}</dt><dd>{root.maxRecords}</dd></div>
          <div><dt>{tr('注册期限', 'Registration term')}</dt><dd>{root.termDays > 0 ? root.termDays + ' ' + tr('天', 'days') : tr('长期有效', 'No expiration')}</dd></div>
          {root.requireReview && <div><dt>{tr('审核', 'Review')}</dt><dd>{tr('需要审核', 'Required')}</dd></div>}
        </dl>
      </li>)}
    </ul>
  </Panel>;
}
