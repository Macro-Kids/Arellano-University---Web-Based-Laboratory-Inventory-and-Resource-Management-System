// -----------------------------------------------------------------------------
// logger.js — tiny leveled logger (console + optional JSON-lines file).
//   const log = createLogger('inventory'); log.info('created', { id: 4 });
// Set LOG_LEVEL=debug for maximum detail, DEBUG_SQL=1 to also trace SQL.
// The last 200 warn/error entries are kept in memory for /api/system/diagnostics.
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;
const recent = [];
let stream = null;

function fileStream() {
  if (!config.logToFile) return null;
  if (stream) return stream;
  try {
    fs.mkdirSync(config.logDir, { recursive: true });
    stream = fs.createWriteStream(path.join(config.logDir, 'app.log'), { flags: 'a' });
    stream.on('error', () => { stream = null; });
  } catch { stream = null; }
  return stream;
}

const COLORS = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m', debug: '\x1b[90m' };
const safe = (meta) => {
  if (!meta) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v;
  }
  return out;
};

function write(level, scope, message, meta) {
  if (LEVELS[level] > threshold) return;
  const entry = { time: new Date().toISOString(), level, scope, message, ...(meta ? { meta: safe(meta) } : {}) };
  if (level === 'error' || level === 'warn') {
    recent.push(entry);
    if (recent.length > 200) recent.shift();
  }
  if (!config.isTest || level === 'error') {
    const t = entry.time.slice(11, 19);
    const tail = entry.meta ? ' ' + JSON.stringify(entry.meta, (_k, v) => (typeof v === 'string' && v.length > 400 ? v.slice(0, 400) + '…' : v)) : '';
    const line = `${COLORS[level]}${t} ${level.toUpperCase().padEnd(5)}\x1b[0m [${scope}] ${message}${tail}`;
    (level === 'error' ? console.error : console.log)(line);
  }
  fileStream()?.write(JSON.stringify(entry) + '\n');
}

export function createLogger(scope) {
  return {
    error: (m, meta) => write('error', scope, m, meta),
    warn: (m, meta) => write('warn', scope, m, meta),
    info: (m, meta) => write('info', scope, m, meta),
    debug: (m, meta) => write('debug', scope, m, meta),
  };
}
export const recentProblems = () => [...recent].reverse();
export function closeLogger() { stream?.end(); stream = null; }
