import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { formatMessage } from '../shared/messages';
import type { AppEnv, Env } from './env';
import { ApiError, fail } from './lib/http';
import { maintenance } from './lib/maintenance';
import { sessionMiddleware } from './lib/session';
import { rpInfo } from './lib/webauthn';
import { account } from './routes/account';
import { admin } from './routes/admin';
import { auth } from './routes/auth';
import { domains, transfers } from './routes/domains';
import { publicRoutes } from './routes/public';

const app = new Hono<AppEnv>().basePath('/api');
app.use('*', async (c, next) => {
  c.set('lang', /^en\b/i.test(c.req.header('accept-language') ?? '') ? 'en' : 'zh');
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    if (c.req.header('x-dotlo-client') !== 'web' || c.req.header('sec-fetch-site') === 'cross-site') fail(403, 'csrf');
    rpInfo(c);
  }
  await next();
});
app.use('*', bodyLimit({ maxSize: 64 * 1024, onError: () => fail(413, 'bad_request') }));
app.use('*', sessionMiddleware);
app.route('/', publicRoutes);
app.route('/auth', auth);
app.route('/account', account);
app.route('/domains', domains);
app.route('/transfers', transfers);
app.route('/admin', admin);
app.notFound(() => fail(404, 'not_found'));
app.onError((error, c) => {
  const e = error instanceof ApiError ? error : new ApiError(500, 'internal');
  if (e !== error) console.error('api', c.req.method, error);
  return c.json({ code: e.code, message: formatMessage(e.code, c.get('lang'), e.params) }, e.status as ContentfulStatusCode);
});

export default {
  fetch: app.fetch,
  scheduled(_event, env, ctx) {
    ctx.waitUntil(maintenance(env));
  },
} satisfies ExportedHandler<Env>;
