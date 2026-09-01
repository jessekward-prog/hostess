#!/usr/bin/env node
const { deployApp } = require('./lib/engine');

const source = process.argv[2];
if (!source) {
  console.error('Usage: node deploy.js <git-url-or-local-path>');
  process.exit(1);
}

deployApp(source, console.log)
  .then((record) => console.log(`\n✔ "${record.name}" is running at http://localhost:${record.port}`))
  .catch((err) => {
    console.error(`\n✘ Deploy failed: ${err.message}`);
    process.exit(1);
  });
