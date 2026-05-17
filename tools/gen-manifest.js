#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const outfile = process.argv[2];
if (!outfile) {
  console.error('Usage: gen-manifest.js <output-file>');
  process.exit(1);
}
const appinfo = JSON.parse(fs.readFileSync(path.join(repoRoot, 'frontend/appinfo.json')));
const ipkfile = `${appinfo.id}_${appinfo.version}_all.ipk`;
const ipkpath = path.join(repoRoot, 'build', ipkfile);
if (!fs.existsSync(ipkpath)) {
  console.error(`Build artifact not found: ${ipkpath}\nRun "npm run package" first.`);
  process.exit(1);
}
const ipkhash = crypto.createHash('sha256').update(fs.readFileSync(ipkpath)).digest('hex');

fs.writeFileSync(
  outfile,
  JSON.stringify({
    id: appinfo.id,
    version: appinfo.version,
    type: appinfo.type,
    title: appinfo.title,
    appDescription: appinfo.appDescription,
    iconUri: 'https://github.com/jellyfin/jellyfin-webos/raw/master/frontend/submission-icon.png',
    sourceUrl: 'https://github.com/jellyfin/jellyfin-webos',
    rootRequired: false,
    ipkUrl: ipkfile,
    ipkHash: {
      sha256: ipkhash,
    },
  }),
);
