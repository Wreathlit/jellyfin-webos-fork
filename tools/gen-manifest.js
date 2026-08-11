#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');

function normalizeRepositoryUrl(repository) {
  const repositoryUrl = typeof repository === 'string'
    ? repository
    : repository && repository.url;

  if (!repositoryUrl) {
    return '';
  }

  return repositoryUrl
    .replace(/^git\+/, '')
    .replace(/\.git$/, '');
}

function createManifest(appinfo, packageInfo, ipkfile, ipkhash, environment) {
  const sourceUrl = normalizeRepositoryUrl(packageInfo.repository);
  if (!sourceUrl) {
    throw new Error('package.json must define a repository URL for manifest source attribution.');
  }

  const sourceRef = (environment && environment.GITHUB_SHA) || 'master';
  return {
    id: appinfo.id,
    version: appinfo.version,
    type: appinfo.type,
    title: appinfo.title,
    appDescription: appinfo.appDescription,
    iconUri: `${sourceUrl}/raw/${encodeURIComponent(sourceRef)}/frontend/submission-icon.png`,
    sourceUrl: sourceUrl,
    rootRequired: false,
    ipkUrl: ipkfile,
    ipkHash: {
      sha256: ipkhash,
    },
  };
}

function main() {
  const outfile = process.argv[2];
  if (!outfile) {
    console.error('Usage: gen-manifest.js <output-file>');
    process.exitCode = 1;
    return;
  }

  const outputPath = path.isAbsolute(outfile) ? outfile : path.join(repoRoot, outfile);
  const appinfo = JSON.parse(fs.readFileSync(path.join(repoRoot, 'frontend/appinfo.json')));
  const packageInfo = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json')));
  const ipkfile = `${appinfo.id}_${appinfo.version}_all.ipk`;
  const ipkpath = path.join(repoRoot, 'build', ipkfile);
  if (!fs.existsSync(ipkpath)) {
    console.error(`Build artifact not found: ${ipkpath}\nRun "npm run package" first.`);
    process.exitCode = 1;
    return;
  }

  const ipkhash = crypto.createHash('sha256').update(fs.readFileSync(ipkpath)).digest('hex');
  const manifest = createManifest(appinfo, packageInfo, ipkfile, ipkhash, process.env);
  fs.writeFileSync(outputPath, JSON.stringify(manifest));
}

if (require.main === module) {
  main();
}

module.exports = {
  createManifest,
  normalizeRepositoryUrl,
};
