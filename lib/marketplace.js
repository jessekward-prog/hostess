// Official Hostess marketplace listing — hand-curated apps, not scraped from
// the registry, so an app only shows up here once it's been vetted as a
// public example. Add an entry to grow the marketplace; nothing auto-populates.
const APPS = [
  {
    name: 'tiny-chat',
    description: 'Minimal chat UI with no configuration of its own — the model endpoint comes entirely from the host platform.',
    repo: 'https://github.com/jessekward-prog/tiny-chat',
  },
];

function list() {
  return APPS;
}

module.exports = { list };
