// HTTP 服务：仅使用 Node.js 内置模块。
// 启动：node server.js（读取 PORT 环境变量，默认 3000；绑定 127.0.0.1）

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAppState,
  runSampling,
  runIncident,
  runEstimate,
  getDebugState,
} from './src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export function createServer() {
  const state = createAppState();

  return http.createServer(async (req, res) => {
    try {
      await route(req, res, state);
    } catch (err) {
      sendJson(res, err.statusCode || 400, {
        error: err.message || '请求处理失败',
      });
    }
  });
}

async function route(req, res, state) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const { pathname } = url;

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return serveStatic(res, 'index.html');
  }
  if (req.method === 'GET' && pathname.startsWith('/public/')) {
    return serveStatic(res, pathname.replace('/public/', ''));
  }
  if (req.method === 'GET' && pathname === '/api/state') {
    return sendJson(res, 200, getDebugState(state));
  }
  if (req.method === 'POST' && pathname === '/api/sample') {
    const body = await readJson(req);
    return sendJson(res, 200, runSampling(state, body));
  }
  if (req.method === 'POST' && pathname === '/api/incident') {
    const body = await readJson(req);
    return sendJson(res, 200, runIncident(state, body));
  }
  if (req.method === 'POST' && pathname === '/api/estimate') {
    const body = await readJson(req);
    return sendJson(res, 200, runEstimate(state, body));
  }
  sendJson(res, 404, { error: `未找到路径: ${pathname}` });
}

function serveStatic(res, relative) {
  const filePath = path.join(PUBLIC_DIR, path.normalize(relative));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: '非法路径' });
  }
  fs.readFile(filePath, (err, data) => {
    if (err) return sendJson(res, 404, { error: '静态资源不存在' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
    });
    res.end(data);
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(Object.assign(new Error('请求体过大'), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

// 直接运行时启动；被测试 import 时不自动监听
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const port = Number(process.env.PORT) || 3000;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`PORT 环境变量非法: ${process.env.PORT}`);
    process.exit(1);
  }
  const server = createServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`分层抽样质检演示已启动: http://127.0.0.1:${port}`);
  });
}
