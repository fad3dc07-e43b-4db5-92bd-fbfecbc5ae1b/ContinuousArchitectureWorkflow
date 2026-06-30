import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const markdownPath = process.argv[2];
const htmlPath = process.argv[3] ?? path.join(path.dirname(markdownPath ?? ''), 'summary.html');

if (!markdownPath) {
  throw new Error('Usage: node test/render-markdown.mjs <markdown-file> [html-file]');
}

const markdown = fs.readFileSync(markdownPath, 'utf8');
const html = markdownToHtml(markdown);

fs.writeFileSync(htmlPath, html, 'utf8');

if (process.env.CI !== 'true') {
  openInBrowser(htmlPath);
}

process.stdout.write(`${htmlPath}\n`);

function markdownToHtml(input) {
  const lines = String(input ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inCode = false;
  let codeBuffer = [];
  let inList = false;
  let inQuote = false;

  const flushCode = () => {
    if (!inCode) return;
    out.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
    codeBuffer = [];
    inCode = false;
  };

  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  const closeQuote = () => {
    if (inQuote) {
      out.push('</blockquote>');
      inQuote = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith('```')) {
      if (inCode) {
        flushCode();
      } else {
        closeList();
        closeQuote();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    if (!line.trim()) {
      closeList();
      closeQuote();
      out.push('<div class="spacer"></div>');
      continue;
    }

    if (line.startsWith('# ')) {
      closeList();
      closeQuote();
      out.push(`<h1>${renderInline(line.slice(2))}</h1>`);
      continue;
    }

    if (line.startsWith('## ')) {
      closeList();
      closeQuote();
      out.push(`<h2>${renderInline(line.slice(3))}</h2>`);
      continue;
    }

    if (line.startsWith('### ')) {
      closeList();
      closeQuote();
      out.push(`<h3>${renderInline(line.slice(4))}</h3>`);
      continue;
    }

    if (line.startsWith('> ')) {
      closeList();
      if (!inQuote) {
        out.push('<blockquote>');
        inQuote = true;
      }
      out.push(`<p>${renderInline(line.slice(2))}</p>`);
      continue;
    }

    if (line.startsWith('- ')) {
      closeQuote();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${renderInline(line.slice(2))}</li>`);
      continue;
    }

    if (line.trimStart().startsWith('<')) {
      closeList();
      closeQuote();
      out.push(line);
      continue;
    }

    closeList();
    closeQuote();
    out.push(`<p>${renderInline(line)}</p>`);
  }

  flushCode();
  closeList();
  closeQuote();

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CALinter Test Report</title>
  <style>
    :root {
      color-scheme: light;
      --page-bg: #f6f8fa;
      --card-bg: #ffffff;
      --card-border: #d0d7de;
      --card-shadow: 0 8px 24px rgba(140, 149, 159, .12);
      --text: #1f2328;
      --muted: #656d76;
      --heading-border: #d0d7de;
      --blockquote-bg: #fff8c5;
      --blockquote-border: #d4a72c;
      --blockquote-text: #5c3d00;
      --code-bg: #0b1020;
      --code-text: #dce7ff;
      --table-header-bg: #f6f8fa;
      --table-border: #d0d7de;
      --button-bg: #f6f8fa;
      --button-hover-bg: #eef1f4;
      --button-text: #24292f;
      --button-border: #d0d7de;
      --focus-ring: #0969da;
    }
    html[data-theme="dark"] {
      color-scheme: dark;
      --page-bg: #0d1117;
      --card-bg: #161b22;
      --card-border: #30363d;
      --card-shadow: 0 8px 24px rgba(1, 4, 9, .45);
      --text: #c9d1d9;
      --muted: #8b949e;
      --heading-border: #30363d;
      --blockquote-bg: #2d2300;
      --blockquote-border: #d4a72c;
      --blockquote-text: #f8e3a1;
      --code-bg: #0b1020;
      --code-text: #dce7ff;
      --table-header-bg: #21262d;
      --table-border: #30363d;
      --button-bg: #21262d;
      --button-hover-bg: #30363d;
      --button-text: #c9d1d9;
      --button-border: #30363d;
      --focus-ring: #58a6ff;
    }
    body { font-family: Segoe UI, Arial, sans-serif; margin: 0; background: var(--page-bg); color: var(--text); }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 24px 64px; }
    .toolbar { display: flex; justify-content: flex-end; margin-bottom: 12px; }
    .theme-toggle {
      display: inline-flex; align-items: center; gap: .5rem;
      appearance: none; border: 1px solid var(--button-border); background: var(--button-bg);
      color: var(--button-text); border-radius: 999px; padding: .55rem .9rem; cursor: pointer;
      font: inherit; line-height: 1; box-shadow: 0 1px 0 rgba(27,31,36,.04);
    }
    .theme-toggle:hover { background: var(--button-hover-bg); }
    .theme-toggle:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
    .card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 16px; box-shadow: var(--card-shadow); padding: 24px; }
    h1, h2, h3 { margin: 1.25em 0 .5em; line-height: 1.2; }
    h1 { font-size: 2rem; }
    h2 { font-size: 1.35rem; border-bottom: 1px solid var(--heading-border); padding-bottom: .35rem; }
    h3 { font-size: 1.05rem; }
    p, li { line-height: 1.55; }
    blockquote { margin: 1rem 0; padding: .75rem 1rem; border-left: 4px solid var(--blockquote-border); background: var(--blockquote-bg); color: var(--blockquote-text); }
    pre { margin: 1rem 0; padding: 1rem; background: var(--code-bg); color: var(--code-text); overflow: auto; border-radius: 12px; }
    code { font-family: Consolas, monospace; font-size: .95em; }
    ul { padding-left: 1.5rem; }
    .spacer { height: .25rem; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid var(--table-border); padding: .5rem .75rem; text-align: left; vertical-align: top; }
    th { background: var(--table-header-bg); }
  </style>
  <script>
    (() => {
      const storageKey = 'calinter-theme';
      const systemTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      const savedTheme = (() => {
        try { return window.localStorage.getItem(storageKey); } catch { return null; }
      })();
      document.documentElement.dataset.theme = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : systemTheme;
    })();
  </script>
</head>
<body>
  <div class="wrap"><div class="card">
<div class="toolbar"><button class="theme-toggle" type="button" id="theme-toggle" aria-pressed="false" aria-label="Cambiar tema"></button></div>
${out.join('\n')}
  </div></div>
  <script>
    (() => {
      const storageKey = 'calinter-theme';
      const button = document.getElementById('theme-toggle');
      const root = document.documentElement;
      const getTheme = () => root.dataset.theme === 'dark' ? 'dark' : 'light';
      const setTheme = (theme) => {
        root.dataset.theme = theme;
        button.textContent = theme === 'dark' ? 'Switch to light' : 'Switch to dark';
        button.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
        try { window.localStorage.setItem(storageKey, theme); } catch {}
      };

      setTheme(getTheme());
      button.addEventListener('click', () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'));
    })();
  </script>
</body>
</html>`;
}

function renderInline(value) {
  return escapeHtml(String(value ?? ''))
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function openInBrowser(filePath) {
  const normalized = path.resolve(filePath);
  const url = `file://${normalized.replace(/\\/g, '/')}`;

  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return;
  }

  if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}
