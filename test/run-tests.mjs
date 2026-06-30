import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const fixtureRoot = path.join(repoRoot, 'test', 'fixtures', 'sample-repo');
const enginePath = path.join(repoRoot, 'src', 'engine.mjs');
const markdownViewerPath = path.join(repoRoot, 'test', 'render-markdown.mjs');
const tempSummary = path.join(os.tmpdir(), 'calinter-summary.md');
const tempHtml = path.join(os.tmpdir(), 'calinter-summary.html');

assertFixtureExists(fixtureRoot);
runEngine(enginePath, ['--mode', 'validate', '--repo-root', fixtureRoot]);
runEngine(enginePath, ['--mode', 'summary', '--repo-root', fixtureRoot], {
  GITHUB_STEP_SUMMARY: tempSummary,
});

renderMarkdown(markdownViewerPath, tempSummary, tempHtml);

const qualityScore = readJson(path.join(repoRoot, 'reports', 'quality-score.json'));
const quickchart = readJson(path.join(repoRoot, 'reports', 'quickchart-radar.json'));
const catalog = readJson(path.join(repoRoot, 'reports', 'catalog.json'));
const summaryMarkdown = fs.readFileSync(tempSummary, 'utf8');

assertSummaryShape(summaryMarkdown);

process.stdout.write(summaryMarkdown);

if (qualityScore.status !== 'incomplete') {
  throw new Error(`Expected quality-score.json to be incomplete, got '${qualityScore.status}'.`);
}

if (quickchart.partial !== true) {
  throw new Error('Expected quickchart-radar.json to be partial.');
}

if (catalog.metadata?.source !== 'artifact/source/design.archimate') {
  throw new Error(`Expected catalog.json source to be artifact/source/design.archimate, got '${catalog.metadata?.source}'.`);
}

if (!fs.existsSync(tempSummary)) {
  throw new Error('Expected summary markdown to be generated.');
}

console.log('CALinter local tests passed.');

function assertFixtureExists(fixturePath) {
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Missing fixture repo: ${fixturePath}`);
  }
}

function runEngine(engine, args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [engine, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  if (result.status !== 0) {
    throw new Error([
      `Engine command failed: node ${args.join(' ')}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean).join('\n'));
  }

  return result;
}

function renderMarkdown(viewer, markdownPath, htmlPath) {
  const result = spawnSync(process.execPath, [viewer, markdownPath, htmlPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error([
      `Markdown viewer failed: node ${path.relative(repoRoot, viewer)} ${path.relative(repoRoot, markdownPath)}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean).join('\n'));
  }

  process.stdout.write(result.stdout);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertSummaryShape(summaryMarkdownText) {
  const requiredLabels = ['Estructura', 'Nomenclatura', 'Integridad', 'Relaciones', 'Trazabilidad', 'Legibilidad'];
  const legacyLabels = ['XML', 'Identidad', 'Estilo', 'Vistas'];
  const forbiddenSections = ['## Observaciones', '## Reglas cumplidas', '## Consistencia del contrato', '## Contrato'];

  if (!summaryMarkdownText.includes('Evaluación parcial')) {
    throw new Error('Expected summary to show Evaluación parcial.');
  }

  if (!summaryMarkdownText.includes('4/6 dimensiones evaluadas')) {
    throw new Error('Expected summary to show coverage 4/6.');
  }

  if (!summaryMarkdownText.includes('## Dashboard') || !summaryMarkdownText.includes('## Reporte de reglas')) {
    throw new Error('Expected summary to include only Dashboard and Reporte de reglas sections.');
  }

  const dashboardSection = summaryMarkdownText.split('## Dashboard')[1]?.split('## Reporte de reglas')[0] ?? '';
  if (dashboardSection.includes('[!WARNING]') || dashboardSection.includes('[!CAUTION]') || dashboardSection.includes('[!TIP]') || dashboardSection.includes('[!NOTE]')) {
    throw new Error('Expected dashboard to avoid admonitions.');
  }

  const chartCount = (summaryMarkdownText.match(/quickchart\.io\/chart\/render/g) ?? []).length;
  if (chartCount !== 3) {
    throw new Error(`Expected exactly 3 dashboard charts, got ${chartCount}.`);
  }

  for (const section of forbiddenSections) {
    if (summaryMarkdownText.includes(section)) {
      throw new Error(`Expected summary not to include legacy section '${section}'.`);
    }
  }

  for (const label of requiredLabels) {
    if (!summaryMarkdownText.includes(label)) {
      throw new Error(`Expected summary to include dimension '${label}'.`);
    }
  }

  for (const label of legacyLabels) {
    if (summaryMarkdownText.includes(label)) {
      throw new Error(`Expected summary not to include legacy dimension '${label}'.`);
    }
  }
}
