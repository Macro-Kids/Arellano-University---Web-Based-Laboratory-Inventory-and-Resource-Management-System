import { Router } from 'express';
import { config } from '../../config.js';
import { parse } from '../../lib/validate.js';
import { send } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { requireAuth, buildUser } from '../../middleware/auth.js';
import { loginSchema, profileSchema, changePasswordSchema } from './schemas.js';
import * as service from './service.js';
import * as repo from './repo.js';

export const router = Router();

const cookieOptions = () => ({
  httpOnly: true, sameSite: 'lax', secure: config.session.cookieSecure, path: '/',
  maxAge: config.session.ttlHours * 3600e3,
});

router.post('/login', async (req, res) => {
  const input = parse(loginSchema, req.body);
  const { token, csrfToken, userId } = await service.login(req.ctx, input);
  res.cookie(config.session.cookieName, token, cookieOptions());
  send(res, service.mePayload(buildUser(repo.findUserById(userId)), csrfToken));
});

router.post('/logout', requireAuth, (req, res) => {
  service.logout(req.ctx);
  res.clearCookie(config.session.cookieName, { path: '/' });
  send(res, { ok: true });
});

router.get('/me', requireAuth, (req, res) => send(res, service.mePayload(req.ctx.user, req.ctx.csrfToken)));

router.patch('/me', requireAuth, (req, res) => {
  const input = parse(profileSchema, req.body);
  service.updateOwnProfile(req.ctx, input);
  send(res, service.mePayload(buildUser(repo.findUserById(req.ctx.user.id)), req.ctx.csrfToken));
});

router.post('/change-password', requireAuth, async (req, res) => {
  await service.changePassword(req.ctx, parse(changePasswordSchema, req.body));
  send(res, { ok: true });
});

// Dev/demo convenience for the sign-in screen. Disabled when SHOW_DEMO_LOGINS=0 (default in production).
router.get('/demo-accounts', (_req, res) => {
  if (!config.showDemoLogins) throw notFound('Endpoint');
  send(res, { password: config.demoPassword, accounts: repo.demoAccounts() });
});
