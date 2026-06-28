import * as cheerio from 'cheerio';
import { XMLValidator } from 'fast-xml-parser';

export function extractXmlRootName(xmlText) {
  const $ = loadXmlDocument(xmlText);
  const root = $.root().children().first().get(0);
  return root?.name ?? '';
}

export function selectXmlNodes(xmlText, selector, options = {}) {
  const $ = loadXmlDocument(xmlText);
  const query = normalizeSelector(selector);
  const rootNodes = $.root().children().toArray();

  if (isXPathSelector(query, options)) {
    const contextNodes = resolveContextNodes($, options);
    return evaluateXPathQuery(contextNodes ?? rootNodes, query, rootNodes, query.startsWith('.'));
  }

  const cssSelector = toCssSelector(query);
  const contextNodes = resolveContextNodes($, options);
  if (!contextNodes) {
    return $(cssSelector).toArray().filter(isElementNode);
  }

  const out = [];
  for (const contextNode of contextNodes) {
    const fragment = cheerio.load(serializeNode(contextNode), { xmlMode: true, decodeEntities: true });
    for (const node of fragment(cssSelector).toArray()) {
      if (isElementNode(node)) {
        out.push(node);
      }
    }
  }
  return dedupeNodes(out);
}

function loadXmlDocument(xmlText) {
  const validation = XMLValidator.validate(xmlText);
  if (validation !== true) {
    const message = validation?.err?.msg ?? 'XML inválido.';
    throw new Error(message);
  }

  return cheerio.load(xmlText, { xmlMode: true, decodeEntities: true });
}

function normalizeSelector(selector) {
  if (selector && typeof selector === 'object') {
    return selector.query ?? selector.selector ?? selector.value ?? '';
  }

  return selector ?? '';
}

function isXPathSelector(selector, options = {}) {
  const language = String(options.language ?? '').toLowerCase();
  return language === 'xpath' || selector.startsWith('/') || selector.startsWith('.') || selector.startsWith('//');
}

function resolveContextNodes($, options) {
  if (Array.isArray(options.contextNodes) && options.contextNodes.length > 0) {
    return options.contextNodes;
  }

  if (options.contextNode) {
    return [options.contextNode];
  }

  if (options.contextXpath) {
    const rootNodes = $.root().children().toArray();
    return evaluateXPathQuery(rootNodes, options.contextXpath, rootNodes, options.contextXpath.startsWith('.'));
  }

  return undefined;
}

function toCssSelector(selector) {
  if (!selector || selector === 'any') {
    return '*';
  }

  if (selector === 'folder' || selector === 'folder[name]') {
    return selector;
  }

  const elementTypeMatch = selector.match(/^element\[xsi:type="([^"]+)"\]$/);
  if (elementTypeMatch) {
    const expectedType = elementTypeMatch[1];
    return `element[xsi\\:type="${escapeCssAttributeValue(expectedType)}"]`;
  }

  return selector;
}

function evaluateXPathQuery(startNodes, xpath, rootNodes = startNodes, relative = false) {
  const steps = tokenizeXPath(xpath);
  if (steps.length === 0) {
    return [];
  }

  let current = !relative && xpath.startsWith('/') ? [makeVirtualRoot(rootNodes)] : startNodes;
  for (const step of steps) {
    current = applyXPathStep(current, step);
  }

  return dedupeNodes(current.filter(isElementNode));
}

function tokenizeXPath(xpath) {
  const normalized = xpath.replace(/^\./, '');
  if (!normalized) {
    return [];
  }

  const steps = [];
  let axis = normalized.startsWith('//') ? 'descendant' : 'child';
  let i = normalized.startsWith('//') || normalized.startsWith('/') ? (normalized.startsWith('//') ? 2 : 1) : 0;
  let buffer = '';

  while (i < normalized.length) {
    if (normalized[i] === '/' && normalized[i + 1] === '/') {
      if (buffer.trim()) {
        steps.push({ axis, segment: buffer.trim() });
        buffer = '';
      }
      axis = 'descendant';
      i += 2;
      continue;
    }

    if (normalized[i] === '/') {
      if (buffer.trim()) {
        steps.push({ axis, segment: buffer.trim() });
        buffer = '';
      }
      axis = 'child';
      i += 1;
      continue;
    }

    buffer += normalized[i];
    i += 1;
  }

  if (buffer.trim()) {
    steps.push({ axis, segment: buffer.trim() });
  }

  return steps;
}

function applyXPathStep(currentNodes, step) {
  const matches = [];
  for (const node of currentNodes) {
    const candidates = step.axis === 'descendant' ? getDescendants(node) : getChildren(node);
    for (const candidate of candidates) {
      if (matchesXPathSegment(candidate, step.segment)) {
        matches.push(candidate);
      }
    }
  }

  return dedupeNodes(matches);
}

function matchesXPathSegment(node, segment) {
  const match = segment.match(/^([^\[]+)(?:\[(.+)\])?$/);
  if (!match) {
    return false;
  }

  const tag = match[1].trim();
  const predicate = match[2];
  if (tag !== '*' && node.name !== tag) {
    return false;
  }

  if (!predicate) {
    return true;
  }

  return evaluateXPathPredicate(node, predicate.trim());
}

function evaluateXPathPredicate(node, predicate) {
  const orParts = splitPredicate(predicate, ' or ');
  if (orParts.length > 1) {
    return orParts.some((part) => evaluateXPathPredicate(node, part));
  }

  const andParts = splitPredicate(predicate, ' and ');
  if (andParts.length > 1) {
    return andParts.every((part) => evaluateXPathPredicate(node, part));
  }

  const trimmed = predicate.trim();
  if (trimmed.startsWith('not(') && trimmed.endsWith(')')) {
    return !evaluateXPathPredicate(node, trimmed.slice(4, -1));
  }

  const attrMatch = trimmed.match(/^@([^=\s\]]+)(?:\s*=\s*"([^"]*)")?$/);
  if (attrMatch) {
    const attrName = attrMatch[1];
    const expectedValue = attrMatch[2];
    const actualValue = node.attribs?.[attrName];
    if (expectedValue === undefined) {
      return actualValue !== undefined;
    }

    return actualValue === expectedValue;
  }

  return false;
}

function splitPredicate(predicate, delimiter) {
  return predicate.includes(delimiter)
    ? predicate.split(delimiter).map((part) => part.trim()).filter(Boolean)
    : [predicate.trim()];
}

function getChildren(node) {
  return (node?.children ?? []).filter(isElementNode);
}

function getDescendants(node) {
  const out = [];
  const visit = (current) => {
    for (const child of getChildren(current)) {
      out.push(child);
      visit(child);
    }
  };

  visit(node);
  return out;
}

function makeVirtualRoot(children) {
  return { name: '#document', children };
}

function dedupeNodes(nodes) {
  const seen = new Set();
  const out = [];
  for (const node of nodes) {
    if (!node || seen.has(node)) {
      continue;
    }
    seen.add(node);
    out.push(node);
  }
  return out;
}

function isElementNode(node) {
  return Boolean(node) && node.type === 'tag';
}

function serializeNode(node) {
  if (!node) {
    return '';
  }

  if (node.type === 'text') {
    return node.data ?? '';
  }

  const name = node.name ?? '';
  const attrs = Object.entries(node.attribs ?? {})
    .map(([key, value]) => ` ${key}="${escapeXmlAttributeValue(String(value))}"`)
    .join('');
  const children = (node.children ?? []).map((child) => serializeNode(child)).join('');
  return `<${name}${attrs}>${children}</${name}>`;
}

function escapeCssAttributeValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeXmlAttributeValue(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
