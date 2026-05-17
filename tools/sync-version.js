#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const appInfoPath = path.join(repoRoot, 'frontend/appinfo.json');
const packageInfo = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json')));
const appInfo = JSON.parse(fs.readFileSync(appInfoPath));

fs.writeFileSync(
  appInfoPath,
  `${JSON.stringify(
    {
      ...appInfo,
      version: packageInfo.version,
    },
    null,
    4,
  )}\n`,
);