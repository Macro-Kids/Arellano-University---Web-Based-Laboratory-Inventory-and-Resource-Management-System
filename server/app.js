// -----------------------------------------------------------------------------
// app.js — assembles the Express application. No listening here (see index.js),
// so tests can mount the same app on any port.
//
//   browser ─▶ security headers ─▶ static files (public/)
//           └▶ /api ─▶ session ─▶ origin/CSRF ─▶ module routers ─▶ error handler
//
// Adding a module = create server/modules/<name>/routes.js and add ONE line below.
// -----------------------------------------------------------------------------
import express from 'express';
import { config } from './config.js';
import { requestContext } from './middleware/context.js';
import { securityHeaders } from './middleware/security.js';
import { loadSession, requireAuth, csrfAndOrigin } from './middleware/auth.js';
import { apiNotFound, errorHandler } from './middleware/errors.js';

import { router as auth } from './modules/auth/routes.js';
import { router as users } from './modules/users/routes.js';
import { router as laboratories } from './modules/laboratories/routes.js';
import { router as categories } from './modules/categories/routes.js';
import { router as inventory } from './modules/inventory/routes.js';
import { router as assets } from './modules/assets/routes.js';
import { router as borrowing } from './modules/borrowing/routes.js';
import { router as maintenance } from './modules/maintenance/routes.js';
import { router as damage } from './modules/damage/routes.js';
import { router as reports } from './modules/reports/routes.js';
import { router as audit } from './modules/audit/routes.js';
import { router as dashboard } from './modules/dashboard/routes.js';
import { router as system } from './modules/system/routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(requestContext);
  app.use(securityHeaders);
  app.use(express.static(config.publicDir, { etag: true, maxAge: config.isProd ? '1h' : 0, index: 'index.html' }));

  const api = express.Router();
  api.use(express.json({ limit: '200kb' }));
  api.use(loadSession);
  api.use(csrfAndOrigin);

  api.use('/system', system);          // health/meta are public; the rest is guarded inside
  api.use('/auth', auth);              // login is public; the rest is guarded inside
  // Everything below requires a signed-in user.
  api.use(requireAuth);
  api.use('/users', users);
  api.use('/laboratories', laboratories);
  api.use('/categories', categories);
  api.use('/inventory', inventory);
  api.use('/assets', assets);
  api.use('/borrowing', borrowing);
  api.use('/maintenance', maintenance);
  api.use('/damage-loss', damage);
  api.use('/reports', reports);
  api.use('/audit', audit);
  api.use('/', dashboard);             // /dashboard, /notifications
  api.use(apiNotFound);

  app.use('/api', api);
  app.use(errorHandler);
  return app;
}
