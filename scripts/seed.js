/**
 * Seed script to populate demo admin and member user accounts
 */
const bcrypt = require('bcryptjs');
const db = require('../server/db/database');

const hash = bcrypt.hashSync('password123', 10);
const now = new Date().toISOString();

// Seed Admin Account
db.prepare(`
  INSERT OR REPLACE INTO users (id, email, password_hash, display_name, is_admin, created_at)
  VALUES (1, 'admin@huddle.local', ?, 'Admin User', 1, ?)
`).run(hash, now);

// Seed Regular Member Account
db.prepare(`
  INSERT OR REPLACE INTO users (id, email, password_hash, display_name, is_admin, created_at)
  VALUES (2, 'user@huddle.local', ?, 'Alex Morgan', 0, ?)
`).run(hash, now);

console.log(' Demo accounts seeded successfully:');
console.log(' - Admin:  admin@huddle.local / password123 (Full /admin console access)');
console.log(' - Member: user@huddle.local  / password123 (Standard participant)');
