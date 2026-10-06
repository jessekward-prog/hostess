// Shared by Forge (forge.html loads it) and the test harness (forge-lab/eval.js requires it).
// Features the request names that a page must visibly have. Small models quietly drop parts of a
// request that combines several features (MULTI2: 7 of 8 asked for photos, ~5 of 21 builds had a
// photo field), so each named feature is checked in the finished page.
const COVERAGE = [
  { need: /\b(photos?|pictures?|images?|pics?|covers?|drawings?|scans?|receipts? photos?)\b/i, has: (h) => /type=["']?file/i.test(h), say: 'photos, but the page has no way to add one (an <input type="file"> saved with files.add)' },
  { need: /\b(pdfs?|documents?|manuals?|docs)\b/i, has: (h) => /type=["']?file/i.test(h), say: 'documents, but the page has no way to add one (an <input type="file"> saved with files.add)' },
  { need: /\b(pages?|tabs?|screens?)\b/i, has: (h) => (h.match(/data-page=/g) || []).length >= 2, say: 'several pages, but the page has only one (use <section data-page="NAME"> for each)' },
  { need: /\bsearch(able|es)?\b/i, has: (h) => /type=["']?search|placeholder=["'][^"']*search|id=["'][^"']*search/i.test(h), say: 'a search, but the page has no search box' },
  { need: /(?<!\b(chore|star|reward|sticker|seating|behaviou?r) )\b(charts?|graphs?)\b/i, has: (h) => /new Chart\(|<canvas|<svg/i.test(h), say: 'a chart, but the page draws none (new Chart(canvas, { type: "bar", data }))' },
  { need: /\bedit\b/i, has: (h) => /\bedit\b/i.test(h.replace(/<title>[\s\S]*?<\/title>/i, '')) && /ask\(|data-edit|contenteditable|editing/i.test(h), say: 'editing, but nothing on the page can be edited (an Edit button that uses ask())' },
  { need: /\bfilters?\b/i, has: (h) => /<select|class=["'][^"']*\b(seg|chips?)\b/i.test(h), say: 'a filter, but the page has none (a select or .seg buttons)' },
  { need: /\bconfirm\b/i, has: (h) => /confirmBox\(/.test(h), say: 'a confirmation, but nothing asks first (await confirmBox(question))' },
];
function coverageGaps(request, html) {
  return COVERAGE.filter((c) => c.need.test(request) && !c.has(html)).map((c) => c.say);
}
if (typeof module !== 'undefined') module.exports = { coverageGaps, COVERAGE };

// Buttons the request names ("a Start button", "a Complete set button"). Forge's test-drive explores
// the app like a person (add something, open it, add inside it…) and each named button must be
// reachable that way: a feature that exists but that nothing leads to is not done.
function namedButtons(request) {
  const out = new Set();
  for (const m of String(request).matchAll(/\b(?:an?|the)\s+([A-Za-z][\w']*(?:\s+[A-Za-z][\w']*){0,2}?)\s+button\b/gi)) {
    const label = m[1].trim();
    if (!/^(this|that|each|every|one|big|small|main|new|back|close)$/i.test(label)) out.add(label);
  }
  return [...out];
}
if (typeof module !== 'undefined') module.exports.namedButtons = namedButtons;
