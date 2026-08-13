import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { waitForSonarQualityGate } from '../src/sonar.mjs';

const required = process.env.FORGEAI_SONAR_REQUIRED === '1';
const token = process.env.SONAR_TOKEN;
const host = process.env.SONAR_HOST_URL;
const project = process.env.SONAR_PROJECT_KEY;
const scanner = process.env.SONAR_SCANNER_BIN ?? 'sonar-scanner';
if (!required && (!token || !host || !project)) {
  process.stdout.write('SonarQube SKIPPED: not required and credentials are absent\n');
  process.exit(0);
}
if (!token || !host || !project) {
  process.stderr.write('SonarQube BLOCKED: SONAR_TOKEN, SONAR_HOST_URL and SONAR_PROJECT_KEY are required\n');
  process.exit(2);
}
const result = spawnSync(scanner, [
  `-Dsonar.host.url=${host}`,
  `-Dsonar.projectKey=${project}`,
  '-Dsonar.sources=src,bin,scripts',
  '-Dsonar.tests=tests',
], { stdio: 'inherit' });
if (result.error || result.status !== 0) process.exit(result.status ?? 1);
await access('.scannerwork/report-task.txt');
const gate = await waitForSonarQualityGate({ reportPath: '.scannerwork/report-task.txt', token, expectedServerUrl: host });
process.stdout.write(`${JSON.stringify(gate)}\n`);
