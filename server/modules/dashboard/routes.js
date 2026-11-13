import { Router } from 'express';
import { send } from '../../lib/http.js';
import * as service from './service.js';

export const router = Router();
router.get('/dashboard', (req, res) => send(res, service.dashboard(req.ctx, req.query)));
router.get('/notifications', (req, res) => send(res, service.notifications(req.ctx)));
