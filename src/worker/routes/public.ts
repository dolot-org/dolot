import { Hono } from 'hono';
import { z } from 'zod';
import { cleanHost, isHostname } from '../../shared/dns';
import { REPORT_CATEGORIES, type PublicConfig } from '../../shared/types';
import type { AppEnv } from '../env';
import { rootDto, type RootRow } from '../lib/domains';
import { rateLimit, verifyTurnstile } from '../lib/guard';
import { fail, readBody } from '../lib/http';
import { DEFAULT_SETTINGS, domainCapacity, getSettings } from '../lib/settings';
import { clientIp, now, randomId, sha256Hex } from '../lib/util';

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get('/config', async (c) => {
  const { DB } = c.env;
  const [settings, roots, counts, capacity] = await Promise.all([
    getSettings(DB),
    DB.prepare("SELECT * FROM roots WHERE status = 'active' ORDER BY sort, domain").all<RootRow>(),
    DB.prepare("SELECT (SELECT COUNT(*) FROM users WHERE status = 'active') AS users, (SELECT COUNT(*) FROM subdomains WHERE status = 'active') AS subdomains")
      .first<PublicConfig['stats']>(),
    domainCapacity(DB),
  ]);
  const result: PublicConfig = {
    siteName: c.env.RP_NAME || 'Dotlo', registrationOpen: settings.registrationOpen, requirePwa: c.env.REQUIRE_PWA !== 'false',
    turnstileSiteKey: c.env.TURNSTILE_SECRET ? c.env.TURNSTILE_SITE_KEY ?? null : null,
    announcement: settings.announcement, contactEmail: settings.contactEmail,
    roots: roots.results.map(rootDto), stats: counts ?? { users: 0, subdomains: 0 },
    domainCapacity: capacity ?? { assigned: 0, limit: DEFAULT_SETTINGS.totalDomainLimit },
  };
  return c.json(result);
});

publicRoutes.post('/reports', async (c) => {
  const { DB } = c.env;
  const ip = clientIp(c);
  await rateLimit(DB, 'report:' + ip, 6, 3_600_000);
  const body = await readBody(c, z.object({
    fqdn: z.string().max(254), category: z.enum(REPORT_CATEGORIES), details: z.string().trim().min(10).max(4000),
    contact: z.string().trim().max(150).default(''), token: z.string().max(2048).optional(),
  }));
  const fqdn = cleanHost(body.fqdn);
  if (!isHostname(fqdn)) fail(400, 'bad_request');
  const sub = await DB.prepare("SELECT id FROM subdomains WHERE fqdn = ?1 OR substr(?1, -(length(fqdn) + 1)) = '.' || fqdn ORDER BY length(fqdn) DESC LIMIT 1")
    .bind(fqdn).first<{ id: string }>();
  if (!sub) fail(404, 'not_found');
  await verifyTurnstile(c, body.token);
  const id = randomId(12);
  const ipHash = ip ? await sha256Hex(id + ':' + ip) : '';
  await DB.prepare('INSERT INTO reports (id, fqdn, subdomain_id, category, details, contact, reporter_id, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, fqdn, sub.id, body.category, body.details, body.contact, c.get('user')?.id ?? null, ipHash, now()).run();
  return c.json({ id }, 201);
});
