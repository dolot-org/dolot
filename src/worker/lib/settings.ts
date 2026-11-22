import type { SiteSettings } from '../../shared/types';

export const DEFAULT_SETTINGS: SiteSettings = {
  registrationOpen: true,
  defaultQuota: 3,
  dailyClaimLimit: 5,
  announcement: '',
  contactEmail: '',
};

export async function getSettings(db: D1Database): Promise<SiteSettings> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of results) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    try {
      const value: unknown = JSON.parse(row.value);
      if (typeof value === typeof DEFAULT_SETTINGS[row.key as keyof SiteSettings]) out[row.key] = value;
    } catch {
      // 忽略损坏的值
    }
  }
  return out as unknown as SiteSettings;
}

export async function saveSettings(db: D1Database, patch: Partial<SiteSettings>) {
  const stmts = Object.entries(patch)
    .filter(([key, value]) => key in DEFAULT_SETTINGS && value !== undefined)
    .map(([key, value]) =>
      db
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .bind(key, JSON.stringify(value)),
    );
  if (stmts.length) await db.batch(stmts);
}
