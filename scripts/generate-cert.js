/**
 * Certificate generator for local HTTPS development and LAN testing.
 * Automatically discovers all local network IPv4 interfaces and binds
 * them to Subject Alternative Names (SANs) in the generated self-signed certificate.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const selfsigned = require('selfsigned');

async function main() {
  const certDir = path.join(__dirname, '..', 'certs');
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }

  // Gather all local IPv4 addresses
  const interfaces = os.networkInterfaces();
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' }
  ];

  const lanIps = [];
  for (const ifaceName of Object.keys(interfaces)) {
    for (const iface of interfaces[ifaceName] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        altNames.push({ type: 7, ip: iface.address });
        lanIps.push(iface.address);
      }
    }
  }

  console.log('Generating self-signed certificate for:');
  console.log(' - localhost / 127.0.0.1');
  lanIps.forEach(ip => console.log(` - ${ip}`));

  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const options = {
    days: 365,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: altNames
      }
    ]
  };

  try {
    const pems = await selfsigned.generate(attrs, options);
    const keyPath = path.join(certDir, 'key.pem');
    const certPath = path.join(certDir, 'cert.pem');

    fs.writeFileSync(keyPath, pems.private, 'utf8');
    fs.writeFileSync(certPath, pems.cert, 'utf8');

    console.log(`\nSSL Certificates successfully created in ./certs:`);
    console.log(` - Private Key: ${keyPath}`);
    console.log(` - Certificate: ${certPath}`);
    console.log(`\nYou can now start Huddle with HTTPS using:`);
    console.log(` USE_HTTPS=true npm start`);
  } catch (err) {
    console.error('Failed to generate certificates:', err);
    process.exit(1);
  }
}

main();
