const fs = require('fs');
const path = require('path');

const unitDir = path.join(__dirname, 'unit');
const tests = fs.readdirSync(unitDir)
    .filter((name) => /\.test\.js$/.test(name))
    .sort();

for (let i = 0; i < tests.length; i++) {
    require(path.join(unitDir, tests[i]));
}

console.log('Unit tests passed.');
