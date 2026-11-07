const http = require('http');
const assert = require('assert');
const app = require('../server/app');
const db = require('../server/db/database');

async function run() {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`Test server running at ${baseUrl}`);

  // 1. Fetch landing page to get CSRF token cookie
  let res = await fetch(`${baseUrl}/`);
  assert.strictEqual(res.status, 200);
  const setCookie = res.headers.get('set-cookie');
  assert(setCookie && setCookie.includes('csrf_token'), 'CSRF cookie must be set');
  const csrfMatch = setCookie.match(/csrf_token=([^;]+)/);
  const csrfToken = csrfMatch ? csrfMatch[1] : '';

  console.log('✓ CSRF cookie received:', csrfToken);

  // 2. Signup first user (should become admin)
  const user1Email = `admin_${Date.now()}@test.com`;
  res = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      'Cookie': `csrf_token=${csrfToken}`
    },
    body: JSON.stringify({
      email: user1Email,
      password: 'password123',
      displayName: 'Admin User'
    })
  });

  const signupData = await res.json();
  assert.strictEqual(res.status, 201, `Signup failed: ${JSON.stringify(signupData)}`);
  assert.strictEqual(signupData.user.isAdmin, true, 'First registered user must be admin');
  assert.strictEqual(signupData.user.displayName, 'Admin User');

  const authCookies = res.headers.get('set-cookie');
  assert(authCookies.includes('token='), 'Auth JWT token cookie must be present');
  const tokenMatch = authCookies.match(/token=([^;]+)/);
  const token = tokenMatch ? tokenMatch[1] : '';

  console.log('✓ First user signup successful & promoted to admin');

  // 3. Check /api/auth/me with auth cookie
  res = await fetch(`${baseUrl}/api/auth/me`, {
    headers: {
      'Cookie': `token=${token}; csrf_token=${csrfToken}`
    }
  });
  const meData = await res.json();
  assert.strictEqual(meData.user.email, user1Email);
  assert.strictEqual(meData.user.isAdmin, true);
  console.log('✓ Auth verification /api/auth/me verified');

  // 4. Signup second user (should NOT be admin)
  const user2Email = `user2_${Date.now()}@test.com`;
  res = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      'Cookie': `csrf_token=${csrfToken}`
    },
    body: JSON.stringify({
      email: user2Email,
      password: 'password123',
      displayName: 'Second User'
    })
  });
  const user2Data = await res.json();
  assert.strictEqual(user2Data.user.isAdmin, false, 'Second user must not be admin');
  console.log('✓ Second user signup successful and verified non-admin');

  // 5. Logout
  res = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: {
      'X-CSRF-Token': csrfToken,
      'Cookie': `token=${token}; csrf_token=${csrfToken}`
    }
  });
  assert.strictEqual(res.status, 200);
  console.log('✓ Logout endpoint verified');

  server.close();
  console.log('\n Milestone 1 tests passed successfully!\n');
}

run().catch(err => {
  console.error('Milestone 1 test failed:', err);
  process.exit(1);
});
