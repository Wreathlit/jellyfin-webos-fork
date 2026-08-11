#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceRoots = ['frontend', 'services', 'tools', 'tests'];
const files = [];

function collectJavaScriptFiles(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            collectJavaScriptFiles(entryPath);
        } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.js') {
            files.push(entryPath);
        }
    }
}

for (const sourceRoot of sourceRoots) {
    collectJavaScriptFiles(path.join(root, sourceRoot));
}

files.sort();
for (const file of files) {
    try {
        childProcess.execFileSync(process.execPath, ['--check', file], {
            cwd: root,
            stdio: 'pipe'
        });
    } catch (error) {
        if (error.stdout) {
            process.stdout.write(error.stdout);
        }
        if (error.stderr) {
            process.stderr.write(error.stderr);
        }
        process.exitCode = 1;
    }
}

if (process.exitCode) {
    console.error('JavaScript syntax check failed.');
} else {
    console.log(`JavaScript syntax check passed (${files.length} files).`);
}
