import * as cheerio from 'cheerio';
import { XMLValidator } from 'fast-xml-parser';

export function extractXmlRootName(xmlText) {
  const $ = loadXmlDocument(xmlText);
  const root = $.root().children().first().get(0);
  return root?.name ?? '';
}

export function selectXmlEntries(xmlText, selector) {
  const $ = loadXmlDocument(xmlText);
  const cssSelector = toCssSelector(selector);

  return $(cssSelector)
    .toArray()
    .map((node) => ({
      tag: node.name ?? '',
      attrs: node.attribs ?? {},
      name: node.attribs?.name,
    }));
}

function loadXmlDocument(xmlText) {
  const validation = XMLValidator.validate(xmlText);
  if (validation !== true) {
    const message = validation?.err?.msg ?? 'XML inválido.';
    throw new Error(message);
  }

  return cheerio.load(xmlText, { xmlMode: true, decodeEntities: true });
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

function escapeCssAttributeValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
