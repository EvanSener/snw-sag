#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function existsAsFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function existsAsDirectory(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function readSchemaName(configPath) {
  if (!existsAsFile(configPath)) {
    return 'spec-driven-zh';
  }

  const content = fs.readFileSync(configPath, 'utf8');
  const match = content.match(/^schema:\s*([^\s#]+)\s*$/m);
  return match?.[1] ?? 'spec-driven-zh';
}

function listActiveChangeDirectories(changesDir) {
  if (!existsAsDirectory(changesDir)) {
    return [];
  }

  return fs
    .readdirSync(changesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'archive')
    .map((entry) => entry.name)
    .sort();
}

function collectSpecFiles(dirPath, output = []) {
  if (!existsAsDirectory(dirPath)) {
    return output;
  }

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectSpecFiles(fullPath, output);
      continue;
    }
    if (entry.isFile() && entry.name === 'spec.md') {
      output.push(fullPath);
    }
  }

  return output;
}

export function validateProjectOpenSpec({ projectRoot = process.cwd() } = {}) {
  const errors = [];
  const warnings = [];
  const openspecRoot = path.join(projectRoot, 'openspec');
  const configPath = path.join(openspecRoot, 'config.yaml');
  const schemaName = readSchemaName(configPath);
  const schemaPath = path.join(openspecRoot, 'schemas', schemaName, 'schema.yaml');
  const specsDir = path.join(openspecRoot, 'specs');
  const changesDir = path.join(openspecRoot, 'changes');

  const requiredEntries = [
    { path: configPath, type: 'file' },
    { path: schemaPath, type: 'file' },
    { path: specsDir, type: 'directory' },
    { path: changesDir, type: 'directory' },
  ];

  for (const entry of requiredEntries) {
    const exists = entry.type === 'file' ? existsAsFile(entry.path) : existsAsDirectory(entry.path);
    if (!exists) {
      errors.push(`缺少必需的 OpenSpec ${entry.type === 'file' ? '文件' : '目录'}：${toPosix(path.relative(projectRoot, entry.path))}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  for (const changeName of listActiveChangeDirectories(changesDir)) {
    const changeDir = path.join(changesDir, changeName);
    const requiredArtifacts = ['proposal.md', 'design.md', 'tasks.md'];

    for (const artifact of requiredArtifacts) {
      const artifactPath = path.join(changeDir, artifact);
      if (!existsAsFile(artifactPath)) {
        errors.push(`active change ${changeName} 缺少必需工件：${toPosix(path.relative(projectRoot, artifactPath))}`);
      }
    }

    const changeSpecsDir = path.join(changeDir, 'specs');
    if (existsAsDirectory(changeSpecsDir) && collectSpecFiles(changeSpecsDir).length === 0) {
      errors.push(`active change ${changeName} 的 specs 目录为空：${toPosix(path.relative(projectRoot, changeSpecsDir))}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function printReport(report) {
  for (const error of report.errors) {
    console.error(`ERROR: ${error}`);
  }
  for (const warning of report.warnings) {
    console.warn(`WARN: ${warning}`);
  }
  if (report.ok) {
    console.log('OpenSpec governance check passed.');
  }
}

function main() {
  const projectRoot = process.cwd();
  const report = validateProjectOpenSpec({ projectRoot });
  printReport(report);
  process.exit(report.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
