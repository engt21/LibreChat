#!/usr/bin/env node
/**
 * dev-push-stale-endpoint-server.js
 *
 * Lightweight HTTP server that returns a configurable HTTP status code for
 * every POST request, simulating a stale/expired push endpoint.
 *
 * Used by dev-validate-schedule-harness.sh to exercise runtime 404/410
 * stale-endpoint pruning behavior (VAL-SCHED-009).
 *
 * Usage:
 *   node dev-push-stale-endpoint-server.js [PORT] [STATUS_CODE]
 *
 * Defaults:
 *   PORT        = 19876
 *   STATUS_CODE = 410
 *
 * The server logs each request and writes a JSON event line to
 * local-services/.dev-schedule-harness-results/stale-endpoint-events.jsonl
 * so the harness can verify delivery attempts and pruning.
 *
 * Exit: Ctrl+C or send SIGTERM.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2], 10) || 19876;
const STATUS_CODE = parseInt(process.argv[3], 10) || 410;

const RESULTS_DIR = path.join(__dirname, '.dev-schedule-harness-results');
const EVENTS_FILE = path.join(RESULTS_DIR, 'stale-endpoint-events.jsonl');

// Ensure results directory exists
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

// Truncate events file on startup
fs.writeFileSync(EVENTS_FILE, '');

const server = http.createServer((req, res) => {
  const event = {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    statusCode: STATUS_CODE,
    headers: {
      'content-type': req.headers['content-type'],
      'content-length': req.headers['content-length'],
    },
  };

  // Collect body (encrypted push payload)
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    event.bodyLength = Buffer.concat(chunks).length;

    // Log to stdout and events file
    const line = JSON.stringify(event);
    console.log(`[stale-endpoint] ${line}`);
    fs.appendFileSync(EVENTS_FILE, line + '\n');

    // Return the configured status code
    res.writeHead(STATUS_CODE, { 'Content-Type': 'text/plain' });
    res.end(STATUS_CODE === 410 ? 'Gone' : 'Not Found');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[stale-endpoint] Mock stale push endpoint listening on http://127.0.0.1:${PORT}`);
  console.log(`[stale-endpoint] Returning HTTP ${STATUS_CODE} for all requests`);
  console.log(`[stale-endpoint] Events log: ${EVENTS_FILE}`);
});

process.on('SIGTERM', () => {
  console.log('[stale-endpoint] Shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[stale-endpoint] Shutting down...');
  server.close(() => process.exit(0));
});
