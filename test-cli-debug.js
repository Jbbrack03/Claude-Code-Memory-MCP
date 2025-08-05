const { spawn } = require('child_process');
const path = require('path');

// Test the CLI directly
const cliPath = path.join(__dirname, 'dist/cli/index.js');
const child = spawn(process.execPath, [cliPath, 'inject-context', '--prompt=test'], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    MEMORY_DB_PATH: ':memory:',
    LOG_LEVEL: 'warn'
  }
});

child.stdout.on('data', (data) => {
  console.log('STDOUT:', data.toString());
});

child.stderr.on('data', (data) => {
  console.error('STDERR:', data.toString());
});

child.on('close', (code) => {
  console.log('Exit code:', code);
});