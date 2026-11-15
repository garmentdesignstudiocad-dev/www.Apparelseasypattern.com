'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ejs = require('ejs');
const root = path.resolve(__dirname, '../views');
const entries = new Map();
const excluded = /(?:^|\/)(?:admin(?:\/|_)|cart|checkout|payment|order|receipt|error|account|login|register|download|customer)/i;
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');

// Compile only literal HTML text. EJS expressions, attributes, scripts, styles,
// form values and transactional screens remain under application control.
function transform(source, filename) {
  const page = path.relative(root, filename).replace(/\\/g, '/');
  if (page.startsWith('..') || excluded.test(page)) return source;
  const blocks = [];
  let masked = source.replace(/<%[\s\S]*?%>/g, value => `\u0001${blocks.push(value) - 1}\u0002`);
  masked = masked.replace(/<!--[\s\S]*?-->|<(script|style|textarea|option)\b[^>]*>[\s\S]*?<\/\1\s*>|<[^>]*>|[^<]+/gi, token => {
    if (token.startsWith('<')) return token;
    return token.split(/(\u0001\d+\u0002)/).map(text => {
      if (/^\u0001/.test(text) || !/[\p{L}]/u.test(text) || /[₹$€]/.test(text)) return text;
      const value = text.trim();
      if (!value) return text;
      const key = crypto.createHash('sha256').update(page + '\0' + value).digest('hex').slice(0, 24);
      entries.set(key, { key, page, value });
      return text.replace(value, `<%- typeof contentText === 'function' ? contentText(${json(key)}, ${json(value)}) : ${json(value)} %>`);
    }).join('');
  });
  return masked.replace(/\u0001(\d+)\u0002/g, (_, index) => blocks[Number(index)]);
}

function catalog() {
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name === 'admin') continue;
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.name.endsWith('.ejs')) transform(fs.readFileSync(file, 'utf8'), file);
    }
  }
  walk(root);
  for (const [name, value] of Object.entries(require('../config/appearance').content)) {
    if (typeof value !== 'string' || /(?:url|path|enabled|email|phone|number|color|font|handle)$/.test(name)) continue;
    const key = 'setting_' + name;
    entries.set(key, { key, page: 'Website settings', value, setting: name });
  }
  return [...entries.values()];
}
function install() {
  const loader = ejs.fileLoader;
  ejs.fileLoader = filename => transform(loader(filename).toString(), filename);
}
function textRenderer(values = {}) {
  return (key, fallback) => Object.hasOwn(values, key) && values[key] !== fallback ? ejs.escapeXML(values[key]) : fallback;
}
module.exports = { transform, catalog, install, textRenderer };
