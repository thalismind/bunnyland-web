import type { CharacterView } from './page';

export function legacyCharacterUrl(href: string, view: CharacterView): string {
  const url = new URL(href);
  url.pathname = url.pathname.replace(/character-(?:chat|sheet)\.html$/, 'character.html');
  if (view === 'chat') url.searchParams.set('view', 'chat');
  else url.searchParams.delete('view');
  return url.href;
}

const view = document.documentElement.dataset.characterView;
if (view === 'chat' || view === 'sheet') {
  location.replace(legacyCharacterUrl(location.href, view));
}
