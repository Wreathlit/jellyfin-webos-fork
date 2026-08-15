const fs = require('fs');
const path = require('path');

const unitDir = path.join(__dirname, 'unit');
const tests = fs.readdirSync(unitDir)
    .filter((name) => /\.test\.js$/.test(name))
    .sort();

// A rejected promise that nobody awaits used to leave the run reporting
// success. Fail loudly instead.
process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection in unit tests:');
    console.error(error);
    process.exit(1);
});

async function run() {
    for (let i = 0; i < tests.length; i++) {
        const testPath = path.join(unitDir, tests[i]);

        // Synchronous suites run on require, as before. A suite that needs to
        // await (the injected runtime drives real promises through the patched
        // fetch) exports a function or a promise, which is awaited here so its
        // failures are reported before the run is declared green.
        const exported = require(testPath);
        if (typeof exported === 'function') {
            await exported();
        } else if (exported && typeof exported.then === 'function') {
            await exported;
        }
    }

    console.log('Unit tests passed.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
