export interface ToolLink {
  description: string;
  href: string;
  label: string;
  supportsServer?: boolean;
  title: string;
}

export const toolLinks: readonly ToolLink[] = [
  { description: 'Replace or reset the live world from a generator, seed, or prompt.', href: 'world-generator.html', label: 'Open Generator', supportsServer: true, title: 'World Generator' },
  { description: 'Browse and extend the world graph from a snapshot or live connection.', href: 'inspector.html', label: 'Open World Graph', supportsServer: true, title: 'World Graph' },
  { description: 'Build behavior-tree JSON for behavioral controllers; register it on a live server.', href: 'behavior-editor.html', label: 'Open Behavior Editor', supportsServer: true, title: 'Behavior Editor' },
  { description: 'Inspect and edit character memory documents and metadata.', href: 'character-memory.html', label: 'Open Memory Editor', supportsServer: true, title: 'Memory Editor' },
  { description: 'Author and validate trigger/action script JSON against a snapshot.', href: 'script-editor.html', label: 'Open Script Editor', title: 'Script Editor' },
  { description: 'Edit entities, components, edges, and saves; pause/resume; LLM patches.', href: 'world-editor.html', label: 'Open World Editor', supportsServer: true, title: 'World Editor' },
  { description: 'Watch the live world event feed with expandable records and entity references.', href: 'event-stream.html', label: 'Open Event Stream', supportsServer: true, title: 'Event Stream' },
  { description: 'Kick, suspend, ban, and review server-wide player identity history.', href: 'moderation.html', label: 'Open Moderation', supportsServer: true, title: 'Player Moderation' },
  { description: 'Inspect live Tempo traces or load JSON and JSONL trace artifacts.', href: 'trace-analyzer.html', label: 'Open Trace Analyzer', supportsServer: true, title: 'Trace Analyzer' },
] as const;

function toolHref(link: ToolLink, server: string): string {
  if (!link.supportsServer || !server) return link.href;
  const url = new URL(link.href, location.href);
  url.searchParams.set('server', server);
  return `${url.pathname.split('/').pop()}${url.search}`;
}

export function ToolLinks({ links, server = '' }: { links: readonly ToolLink[]; server?: string }) {
  return <>{links.map((link) => (
    <article class="client-card" data-tool-href={link.href} key={link.href}>
      <h3>{link.title}</h3>
      <p>{link.description}</p>
      <a class="button-link primary" href={toolHref(link, server)}>{link.label}</a>
    </article>
  ))}</>;
}
