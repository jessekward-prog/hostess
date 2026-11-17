const fs = require('fs');
const path = require('path');

// The Build tab's two prompts. The compliance one is the website's "Copy prompt" text, read from RULES.html
// itself (its <textarea id="promptText">) so there is only one copy to keep current.
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' };

function load() {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'RULES.html'), 'utf8');
  const raw = /<textarea[^>]*id="promptText"[^>]*>([\s\S]*?)<\/textarea>/.exec(rules);
  if (!raw) throw new Error('RULES.html has no promptText textarea');
  return {
    newApp: fs.readFileSync(path.join(__dirname, 'build-prompt.txt'), 'utf8').trim(),
    compliance: raw[1].replace(/&(?:lt|gt|quot|#39|amp);/g, (e) => ENTITIES[e]).trim(),
  };
}

module.exports = { load };
