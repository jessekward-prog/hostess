// Official Hostess marketplace listing — hand-curated apps, not scraped from
// the registry, so an app only shows up here once it's been vetted as a
// public example. Add an entry to grow the marketplace; nothing auto-populates.
const APPS = [
  {
    name: 'tiny-chat',
    description: 'Minimal chat UI with no configuration of its own — the model endpoint comes entirely from the host platform.',
    repo: 'https://github.com/jessekward-prog/tiny-chat',
    icon: 'https://raw.githubusercontent.com/jessekward-prog/tiny-chat/main/public/icon.png',
  },
  {
    name: 'mood-cmd',
    description: 'Ten-second mood and energy check-ins in a 16-bit skin. Your local model writes the weekly report; nudges go out over ntfy.',
    repo: 'https://github.com/jessekward-prog/mood-cmd',
    icon: 'https://raw.githubusercontent.com/jessekward-prog/mood-cmd/main/public/icons/icon-192.png',
  },
];

function list() {
  return APPS;
}

module.exports = { list };
