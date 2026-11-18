import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const publicFiles = ['index.html', 'styles.css', 'liquid-glass.css', 'app.js', 'cloud-client.js', 'cloud-config.js', 'tools.js', 'manifest.webmanifest', 'sw.js', 'icon.svg', 'icon-192.png', 'icon-512.png', 'chess-logo.png', 'THIRD_PARTY_NOTICES.md'];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const file of publicFiles) {
  const source = path.join(root, file);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`Missing public app file: ${file}`);
  fs.copyFileSync(source, path.join(out, file));
}
const cloudConfig = {
  url: process.env.SUPABASE_URL || '',
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || ''
};
fs.writeFileSync(path.join(out, 'cloud-config.js'), `window.TRADELOG_CLOUD_CONFIG = Object.freeze(${JSON.stringify(cloudConfig)});\n`);
console.log(`Built static TradeLog web app in ${out}`);
