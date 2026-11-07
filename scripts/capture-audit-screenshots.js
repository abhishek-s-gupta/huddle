/**
 * Screenshot generator for Design Audit
 * Captures all pages, states, and viewports (1440px, 1024px, 390px)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const app = require('../server/app');
const { Server } = require('socket.io');
const initSockets = require('../server/sockets');
const { authenticateSocket } = require('../server/middleware/auth');
const db = require('../server/db/database');
const bcrypt = require('bcryptjs');

const outDir = path.join(__dirname, '..', 'tests', 'screenshots', 'verified');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

async function capture() {
  console.log('Starting Design Audit Screenshot Capture...');

  // Reset database with predictable mock data
  db.prepare('DELETE FROM messages_meta').run();
  db.prepare('DELETE FROM files').run();
  db.prepare('DELETE FROM room_participants').run();
  db.prepare('DELETE FROM rooms').run();
  db.prepare('DELETE FROM audit_logs').run();
  db.prepare('DELETE FROM users').run();

  const hash = bcrypt.hashSync('password123', 10);
  const now = new Date().toISOString();

  // Create Admin Host
  const u1 = db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, is_admin, created_at)
    VALUES (1, 'alex@huddle.local', ?, 'Alex Carter', 1, ?)
  `).run(hash, now);

  // Create Participants
  db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, is_admin, created_at)
    VALUES (2, 'jordan@huddle.local', ?, 'Jordan Lee', 0, ?)
  `).run(hash, now);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, is_admin, created_at)
    VALUES (3, 'casey@huddle.local', ?, 'Casey Reed', 0, ?)
  `).run(hash, now);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, is_admin, created_at)
    VALUES (4, 'taylor@huddle.local', ?, 'Taylor Morgan', 0, ?)
  `).run(hash, now);

  // Create Past Meetings for History
  const r1 = db.prepare(`
    INSERT INTO rooms (id, code, title, host_id, is_locked, is_ended, created_at, ended_at)
    VALUES (1, 'hud-des-spr', 'Weekly Design Sprint', 1, 0, 1, datetime('now', '-2 days'), datetime('now', '-2 days', '+45 minutes'))
  `).run();

  db.prepare(`
    INSERT INTO room_participants (room_id, user_id, role, joined_at, left_at)
    VALUES (1, 1, 'host', datetime('now', '-2 days'), datetime('now', '-2 days', '+45 minutes'))
  `).run();

  const r2 = db.prepare(`
    INSERT INTO rooms (id, code, title, host_id, is_locked, is_ended, created_at, ended_at)
    VALUES (2, 'hud-eng-arc', 'Backend Architecture Review', 2, 0, 1, datetime('now', '-1 day'), datetime('now', '-1 day', '+60 minutes'))
  `).run();

  db.prepare(`
    INSERT INTO room_participants (room_id, user_id, role, joined_at, left_at)
    VALUES (2, 1, 'participant', datetime('now', '-1 day'), datetime('now', '-1 day', '+60 minutes'))
  `).run();

  // Active room for live call testing
  const activeRoomCode = 'hud-live-meet';
  db.prepare(`
    INSERT INTO rooms (id, code, title, host_id, is_locked, is_ended, created_at)
    VALUES (3, ?, 'Sprint Sync & Demo', 1, 0, 0, datetime('now', '-10 minutes'))
  `).run(activeRoomCode);

  // Start in-memory test server
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  io.use(authenticateSocket);
  initSockets(io);

  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--no-sandbox'
    ]
  });

  const viewports = [
    { name: '1440', width: 1440, height: 900 },
    { name: '1024', width: 1024, height: 768 },
    { name: '390', width: 390, height: 844 }
  ];

  // 1. Landing & Auth screenshots across viewports
  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();

    await page.goto(baseUrl);
    await page.waitForFunction(() => window.__authReady === true);
    await page.screenshot({ path: path.join(outDir, `01-landing-signin-${vp.name}.png`), fullPage: true });

    // Switch to Signup tab
    await page.click('#tab-signup');
    await page.waitForSelector('#input-name', { state: 'visible' });
    await page.screenshot({ path: path.join(outDir, `02-landing-signup-${vp.name}.png`), fullPage: true });

    await ctx.close();
  }

  // 2. Dashboard screenshots (with history)
  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();

    // Login as Alex
    await page.goto(baseUrl);
    await page.waitForFunction(() => window.__authReady === true);
    await page.fill('#input-email', 'alex@huddle.local');
    await page.fill('#input-password', 'password123');
    await page.click('#btn-submit');
    await page.waitForURL('**/dashboard');
    await page.waitForSelector('#history-tbody tr');

    await page.screenshot({ path: path.join(outDir, `03-dashboard-history-${vp.name}.png`), fullPage: true });

    // Open create meeting modal on desktop
    if (vp.name === '1440') {
      await page.click('#btn-open-create-modal');
      await page.waitForSelector('#modal-create-room.active');
      await page.screenshot({ path: path.join(outDir, `04-dashboard-modal-create-${vp.name}.png`) });
      await page.click('#btn-close-modal');
    }

    await ctx.close();
  }

  // 3. Pre-join Lobby
  for (const vp of viewports) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      permissions: ['camera', 'microphone']
    });
    const page = await ctx.newPage();

    await page.goto(baseUrl);
    await page.waitForFunction(() => window.__authReady === true);
    await page.fill('#input-email', 'alex@huddle.local');
    await page.fill('#input-password', 'password123');
    await page.click('#btn-submit');
    await page.waitForURL('**/dashboard');

    await page.goto(`${baseUrl}/lobby/${activeRoomCode}`);
    await page.waitForSelector('#preview-video');
    await page.screenshot({ path: path.join(outDir, `05-lobby-${vp.name}.png`), fullPage: true });

    await ctx.close();
  }

  // 4. Video Call screen (1 participant, 2 participants, 4 participants)
  // Host
  const ctxHost = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['camera', 'microphone']
  });
  const pageHost = await ctxHost.newPage();
  await pageHost.goto(baseUrl);
  await pageHost.waitForFunction(() => window.__authReady === true);
  await pageHost.fill('#input-email', 'alex@huddle.local');
  await pageHost.fill('#input-password', 'password123');
  await pageHost.click('#btn-submit');
  await pageHost.waitForURL('**/dashboard');

  await pageHost.goto(`${baseUrl}/room/${activeRoomCode}#key=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`);
  await pageHost.waitForFunction(() => window.__roomReady === true);
  await pageHost.waitForSelector('#tile-local video');

  // Screenshot 1 participant (desktop and mobile)
  await pageHost.screenshot({ path: path.join(outDir, '06-call-1-participant-1440.png') });

  // Connect Participant 2 (Jordan)
  const ctxP2 = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['camera', 'microphone']
  });
  const pageP2 = await ctxP2.newPage();
  await pageP2.goto(baseUrl);
  await pageP2.waitForFunction(() => window.__authReady === true);
  await pageP2.fill('#input-email', 'jordan@huddle.local');
  await pageP2.fill('#input-password', 'password123');
  await pageP2.click('#btn-submit');
  await pageP2.waitForURL('**/dashboard');
  await pageP2.goto(`${baseUrl}/room/${activeRoomCode}#key=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`);
  await pageP2.waitForFunction(() => window.__roomReady === true);

  // Wait for 2 tiles on host page
  await pageHost.waitForSelector('.video-tile:not(#tile-local)', { timeout: 15000 });
  await pageHost.screenshot({ path: path.join(outDir, '07-call-2-participants-1440.png') });

  // Connect Participant 3 (Casey)
  const ctxP3 = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['camera', 'microphone']
  });
  const pageP3 = await ctxP3.newPage();
  await pageP3.goto(baseUrl);
  await pageP3.waitForFunction(() => window.__authReady === true);
  await pageP3.fill('#input-email', 'casey@huddle.local');
  await pageP3.fill('#input-password', 'password123');
  await pageP3.click('#btn-submit');
  await pageP3.waitForURL('**/dashboard');
  await pageP3.goto(`${baseUrl}/room/${activeRoomCode}#key=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`);
  await pageP3.waitForFunction(() => window.__roomReady === true);

  // Connect Participant 4 (Taylor)
  const ctxP4 = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['camera', 'microphone']
  });
  const pageP4 = await ctxP4.newPage();
  await pageP4.goto(baseUrl);
  await pageP4.waitForFunction(() => window.__authReady === true);
  await pageP4.fill('#input-email', 'taylor@huddle.local');
  await pageP4.fill('#input-password', 'password123');
  await pageP4.click('#btn-submit');
  await pageP4.waitForURL('**/dashboard');
  await pageP4.goto(`${baseUrl}/room/${activeRoomCode}#key=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`);
  await pageP4.waitForFunction(() => window.__roomReady === true);

  // Wait for 4 tiles on host
  await pageHost.waitForFunction(() => document.querySelectorAll('.video-tile').length === 4, { timeout: 15000 });
  await pageHost.screenshot({ path: path.join(outDir, '08-call-4-participants-1440.png') });

  // Chat panel open with sample messages
  await pageHost.click('#btn-dock-chat');
  await pageHost.waitForSelector('#side-panel.open');
  await pageHost.fill('#input-chat', 'Hello team, welcome to the design sprint!');
  await pageHost.click('#btn-send-chat');
  await pageHost.waitForTimeout(500);
  await pageHost.screenshot({ path: path.join(outDir, '09-call-chat-panel-1440.png') });

  // Files panel
  await pageHost.click('#tab-btn-files');
  await pageHost.waitForSelector('#pane-files.active');
  await pageHost.screenshot({ path: path.join(outDir, '10-call-files-panel-1440.png') });

  // People panel
  await pageHost.click('#tab-btn-people');
  await pageHost.waitForSelector('#pane-people.active');
  await pageHost.screenshot({ path: path.join(outDir, '11-call-people-panel-1440.png') });

  // Whiteboard overlay
  await pageHost.click('#btn-dock-whiteboard');
  await pageHost.waitForSelector('#whiteboard-stage:not([style*="display: none"])');
  await pageHost.screenshot({ path: path.join(outDir, '12-call-whiteboard-1440.png') });
  await pageHost.click('#wb-btn-close');

  // Admin Console
  const pageAdmin = await ctxHost.newPage();
  await pageAdmin.goto(`${baseUrl}/admin`);
  await pageAdmin.waitForSelector('#tbody-users tr');
  await pageAdmin.screenshot({ path: path.join(outDir, '13-admin-console-1440.png'), fullPage: true });

  // 404 Page
  await pageAdmin.goto(`${baseUrl}/this-page-does-not-exist`);
  await pageAdmin.screenshot({ path: path.join(outDir, '14-404-page-1440.png') });

  await ctxHost.close();
  await ctxP2.close();
  await ctxP3.close();
  await ctxP4.close();
  await browser.close();
  server.close();

  console.log('✅ Audit screenshots captured in tests/screenshots/audit/');
  process.exit(0);
}

capture().catch(err => {
  console.error('Audit capture failed:', err);
  process.exit(1);
});
