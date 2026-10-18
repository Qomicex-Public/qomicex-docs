// Convert VitePress Markdown (qomicex-public/docs) into Mintlify MDX.
// Usage: node convert.mjs <srcDocsDir> <outDir>
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
const OUT = process.argv[3];
const ROOT = process.argv[4] || path.dirname(OUT);

const CALLOUT_MAP = { tip: 'Tip', warning: 'Warning', danger: 'Warning', info: 'Note', note: 'Note' };
const FENCE = (i) => `\u0000FENCE:${i}\u0000`;
const FENCE_RE = /^\u0000FENCE:(\d+)\u0000$/;

// Nav order mirrors docs/.vitepress/config.mts (nav + sidebar groups).
const PAGE_ORDER = [
  'guide/index.md',
  'guide/getting-started.md',
  'guide/first-start.md',
  'guide/dashboard-widget.md',
  'guide/installing-games.md',
  'guide/instances.md',
  'guide/modpack-support.md',
  'guide/resource-center.md',
  'guide/downloads.md',
  'guide/accounts.md',
  'guide/connect.md',
  'guide/running.md',
  'guide/log-analysis.md',
  'guide/plugins.md',
  'guide/deep-link.md',
  'guide/settings.md',
  'guide/mirror.md',
  'guide/glossary.md',
  'guide/faq.md',
  'guide/report-issue.md',
  'guide/optimize.md',
  'guide/legal.md',
  'plugins/index.md',
  'plugins/creating-plugin.md',
  'plugins/react-plugin.md',
  'plugins/manifest.md',
  'plugins/plugin-api.md',
  'plugins/plugin-ui.md',
  'plugins/dependencies.md',
  'plugins/wasm-plugin.md',
  'plugins/webview-l4.md',
  'plugins/overlay.md',
  'plugins/dashboard-widget.md',
  'plugins/settings-page.md',
  'plugins/hooks.md',
  'plugins/theme.md',
  'plugins/cli.md',
  'plugins/debugging.md',
  'plugins/ai-development.md',
  'plugins/publishing.md',
  'plugins/telemetry.md',
  'plugins/pitfalls.md',
  'libraries/index.md',
  'libraries/markdownlib.md',
  'libraries/markitdown.md',
  'store/index.md',
  'store/publish.md',
  'store/registry-spec.md',
];

function slugify(text) {
  return text
    .trim()
    .replace(/`/g, '')
    .replace(/[*_]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function splitFrontmatter(lines) {
  if (lines[0] !== '---') return { fm: null, body: lines };
  const end = lines.indexOf('---', 1);
  if (end < 0) return { fm: null, body: lines };
  return { fm: lines.slice(1, end), body: lines.slice(end + 1) };
}

// Source page path without the .md extension, e.g. "guide/index" or "plugins/manifest".
function pageRoute(rel) {
  return rel.replace(/\\/g, '/').replace(/\.md$/, '');
}

// VitePress/Markdown autolinks (<https://...>) are not valid MDX; keep the URL as a normal link.
function rewriteAutolinks(text) {
  return text.replace(/<((?:https?:\/\/)[^<>\s]+)>/g, (whole, url) => '[' + url + '](' + url + ')');
}

// Internal links: VitePress emits directory-relative links; Mintlify needs root-relative
// paths without a file extension. Resolve against the source page's own directory.
function rewriteLinks(lines, relRoute) {
  const dir = relRoute.includes('/') ? relRoute.split('/').slice(0, -1).join('/') : '';
  const resolve = (target) => {
    const [pathPart, frag] = target.split('#');
    let resolved;
    if (pathPart === '' || pathPart === './') {
      resolved = '/' + dir;
    } else if (pathPart === '../') {
      resolved = '/' + dir.split('/').slice(0, -1).join('/');
    } else {
      const raw = dir ? dir + '/' + pathPart : pathPart;
      const parts = [];
      for (const seg of raw.split('/')) {
        if (seg === '..') parts.pop();
        else if (seg !== '.' && seg !== '') parts.push(seg);
      }
      resolved = '/' + parts.join('/');
    }
    resolved = resolved.replace(/\/+$/, '') || '/';
    return '](' + resolved + (frag ? '#' + frag : '') + ')';
  };
  // String concatenation only: replacement-string patterns like $& would corrupt the path.
  return lines.map((line) => {
    const re = /\]\(([^)\s]*)\)/g;
    let m;
    const edits = [];
    while ((m = re.exec(line))) {
      if (/^\.\.?\//.test(m[1])) edits.push({ index: m.index, length: m[0].length, text: resolve(m[1]) });
    }
    if (!edits.length) return line;
    let out = '';
    let last = 0;
    for (const e of edits) {
      out += line.slice(last, e.index) + e.text;
      last = e.index + e.length;
    }
    return out + line.slice(last);
  });
}

function convertLines(lines, ctx) {
  const out = [];
  let i = 0;
  let listBuffer = [];

  const flushList = () => {
    if (!listBuffer.length) return;
    const items = [];
    for (const raw of listBuffer) {
      const m = raw.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
      if (m) items.push({ text: m[1], extra: [] });
      else if (items.length) items[items.length - 1].extra.push(raw.trim());
    }
    // Inside callouts, long bullet stacks of independent tips read better as accordions and
    // avoid MDX list/paragraph ambiguity.
    const heavy = ctx.inCallout && items.length >= 3 && items.some((it) => it.text.length > 60);
    if (heavy) {
      out.push('<AccordionGroup>');
      for (const it of items) {
        const title = it.text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`/g, '').trim();
        out.push(`<Accordion title="${title.replace(/"/g, '&quot;')}">`);
        out.push(it.text);
        for (const e of it.extra) out.push('', e);
        out.push('</Accordion>');
        out.push('');
        void title;
      }
      out.push('</AccordionGroup>');
      out.push('');
    } else {
      for (const it of items) {
        out.push(`- ${it.text}`);
        for (const e of it.extra) out.push(`  ${e}`);
      }
    }
    listBuffer = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (/^```/.test(t)) {
      flushList();
      const langRaw = t.replace(/^```+/, '').trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      ctx.fences.push({ langRaw, buf });
      out.push(FENCE(ctx.fences.length - 1));
      continue;
    }

    if (/^\u0000FENCE:\d+\u0000$/.test(t)) {
      out.push(t);
      i++;
      continue;
    }

    const containerOpen = t.match(/^:::([^\s:]*)\s*(.*)$/);
    if (containerOpen) {
      flushList();
      const kind = containerOpen[1].toLowerCase();
      const title = containerOpen[2].trim();
      if (!kind) {
        i++;
        continue;
      }
      let depth = 1;
      const inner = [];
      i++;
      while (i < lines.length) {
        const s = lines[i].trim();
        if (/^:::\s*$/.test(s)) {
          depth--;
          if (depth === 0) break;
          inner.push(lines[i]);
          i++;
          continue;
        }
        if (/^:::/.test(s)) depth++;
        inner.push(lines[i]);
        i++;
      }
      i++;
      const prevCallout = ctx.inCallout;
      ctx.inCallout = kind !== 'code-group';
      const innerOut = convertLines(inner, ctx);
      ctx.inCallout = prevCallout;

      if (kind === 'code-group') {
        out.push(...innerOut);
        continue;
      }
      if (kind === 'details') {
        out.push('<AccordionGroup>');
        out.push(`<Accordion title="${(title || '详情').replace(/"/g, '&quot;')}">`);
        for (const l of innerOut) out.push(l.trim() === '' ? '' : '  ' + l);
        out.push('</Accordion>');
        out.push('</AccordionGroup>');
        out.push('');
        continue;
      }
      const tag = CALLOUT_MAP[kind] || 'Note';
      out.push(`<${tag}>`);
      if (title) {
        if (title.startsWith('`')) out.push(title);
        else out.push(`**${title}**`);
      }
      out.push(...innerOut);
      out.push(`</${tag}>`);
      out.push('');
      continue;
    }


    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const text = heading[2].trim();
      ctx.anchors.push([text, slugify(text)]);
      out.push(level === 1 ? `## ${text}` : line);
      i++;
      continue;
    }

    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      listBuffer.push(line);
      i++;
      continue;
    }
    if (listBuffer.length && /^\s{2,}\S/.test(line)) {
      listBuffer.push(line);
      i++;
      continue;
    }
    flushList();

    out.push(line);
    i++;
  }
  flushList();
  return out;
}

// Keep paragraph/list blocks inside callouts separated by blank lines (MDX needs them).
function fixCallouts(lines) {
  const out = [];
  const openRe = /^<(Note|Tip|Warning|Info|Check)>$/;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const m = t.match(openRe);
    if (!m) {
      out.push(lines[i]);
      continue;
    }
    const inner = [];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== `</${m[1]}>`) {
      inner.push(lines[j]);
      j++;
    }
    while (inner.length && inner[0].trim() === '') inner.shift();
    while (inner.length && inner[inner.length - 1].trim() === '') inner.pop();

    const blocks = [];
    let cur = { kind: 'para', lines: [] };
    const push = () => {
      if (cur.lines.length) blocks.push(cur);
      cur = { kind: 'para', lines: [] };
    };
    for (const l of inner) {
      const s = l.trim();
      if (FENCE_RE.test(s) || /^<(AccordionGroup|Accordion|Card|Columns|Tabs)>/.test(s)) {
        push();
        blocks.push({ kind: 'opaque', lines: [l] });
        continue;
      }
      if (/^\s*(?:[-*+]|\d+\.)\s+/.test(l)) {
        if (cur.kind !== 'list') {
          push();
          cur.kind = 'list';
        }
        cur.lines.push(l);
        continue;
      }
      if (s === '') {
        push();
        continue;
      }
      if (/^\|/.test(s)) {
        if (cur.kind !== 'table') {
          push();
          cur.kind = 'table';
        }
        cur.lines.push(l);
        continue;
      }
      if (cur.kind === 'list' || cur.kind === 'table') push();
      cur.lines.push(l);
    }
    push();

    out.push(`<${m[1]}>`);
    blocks.forEach((b, idx) => {
      if (idx > 0) out.push('');
      out.push(...b.lines);
    });
    out.push(`</${m[1]}>`);
    i = j;
  }
  return out;
}

function langFor(langRaw) {
  if (!langRaw) return 'text';
  const base = langRaw.split(/\s+/)[0].toLowerCase();
  if (!base) return 'text';
  const map = { sh: 'bash', shell: 'bash', ps: 'powershell', text: 'text' };
  return map[base] || base;
}

function fenceTitle(langRaw) {
  const compact = langRaw.trim();
  const bracket = compact.match(/\[([^\]]+)\]/);
  const curly = compact.match(/\{([^}]+)\}/);
  if (bracket) return bracket[1].trim();
  if (curly) return curly[1].trim();
  return compact.split(/\s+/).slice(1).join(' ').trim();
}

function assemble(lines, fences) {
  const out = [];
  for (const line of lines) {
    const m = line.trim().match(FENCE_RE);
    if (m) {
      const { langRaw, buf } = fences[Number(m[1])];
      const title = fenceTitle(langRaw);
      out.push('```' + langFor(langRaw) + (title ? ' ' + title : ''));
      out.push(...buf.map((b) => b.replace(/\s+$/g, '')));
      out.push('```');
      continue;
    }
    out.push(line.replace(/\s+$/g, ''));
  }
  return out;
}

// Renderer-specific syntax that MDX rejects: HTML comments, <br> inside table cells,
// and GFM autolinks. Unsupported content is preserved as plain text rather than dropped.
function mdxSafeties(lines) {
  const out = [];
  for (const line of lines) {
    if (/^\s*<!--/.test(line) && /-->\s*$/.test(line)) {
      // Keep the comment label as text; HTML comments are not valid MDX.
      const text = line.trim().replace(/^<!--\s*/, '').replace(/\s*-->$/, '').trim();
      out.push(text ? `（${text}）` : '');
      continue;
    }
    out.push(line.replace(/<br\s*\/?>/gi, '<br></br>'));
  }
  return out;
}

function buildPage(rel) {
  const raw = fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');
  const srcLines = raw.split('\n');
  const { fm, body } = splitFrontmatter(srcLines);
  let fmTitle = null;
  let fmDescription = null;
  if (fm) {
    for (const l of fm) {
      const m = l.match(/^(title|description):\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^['"]|['"]$/g, '');
      if (m[1] === 'title') fmTitle = v;
      else fmDescription = v;
    }
  }
  const relRoute = pageRoute(rel);
  const ctx = { fences: [], anchors: [], inCallout: false };
  let converted = convertLines(body, ctx);
  converted = assemble(converted, ctx.fences);
  converted = mdxSafeties(converted);
  converted = rewriteLinks(converted, relRoute);
  converted = converted.map(rewriteAutolinks);

  while (converted.length && converted[0].trim() === '') converted.shift();
  while (converted.length && converted[converted.length - 1].trim() === '') converted.pop();

  let h1 = null;
  if (converted.length && /^## /.test(converted[0])) h1 = converted[0].slice(3).trim();
  const pageTitle = h1 || fmTitle || path.basename(rel, '.md');
  const lines = ['---', `title: ${JSON.stringify(pageTitle)}`];
  if (fmDescription) lines.push(`description: ${JSON.stringify(fmDescription)}`);
  lines.push('---', '');
  return {
    rel,
    title: pageTitle,
    anchors: ctx.anchors,
    content: lines.join('\n') + remapRetiredAnchors(converted.join('\n')) + '\n',
  };
}

// Internal anchors that moved when the source H1 became the page title.
const RETIRED_ANCHORS = {
  '/plugins/#插件开发概览': '/plugins/',
  '/plugins/#目录': '/plugins/',
};
function remapRetiredAnchors(text) {
  let out = text;
  for (const [from, to] of Object.entries(RETIRED_ANCHORS)) out = out.split(from).join(to);
  return out;
}

const pages = PAGE_ORDER.map((rel) => buildPage(rel));
fs.mkdirSync(OUT, { recursive: true });
for (const page of pages) {
  const dest = path.join(OUT, page.rel.replace(/\.md$/, '.mdx'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, page.content, 'utf8');
}
fs.writeFileSync(
  path.join(ROOT, 'convert-report.json'),
  JSON.stringify(pages.map((p) => ({ rel: p.rel, title: p.title, anchors: p.anchors.map((a) => a[1]) })), null, 2),
  'utf8',
);
console.log(`wrote ${pages.length} pages to ${OUT}`);
