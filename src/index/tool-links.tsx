import { render } from 'preact';

export interface ToolLink {
  description: string;
  href: string;
  label: string;
  title: string;
}

export const toolLinks: readonly ToolLink[] = [
  { description: 'Replace or reset the live world from a generator, seed, or prompt.', href: 'world-generator.html', label: 'Open Generator', title: 'World Generator' },
  { description: 'Browse the world as a graph — a loaded snapshot or a live connection.', href: 'inspector.html', label: 'Open Inspector', title: 'World Inspector' },
  { description: 'Build behavior-tree JSON for behavioral controllers; register it on a live server.', href: 'behavior-editor.html', label: 'Open Behavior Editor', title: 'Behavior Editor' },
  { description: 'Inspect and edit character memory documents and metadata.', href: 'character-memory.html', label: 'Open Memory Editor', title: 'Memory Editor' },
  { description: 'Author and validate trigger/action script JSON against a snapshot.', href: 'script-editor.html', label: 'Open Script Editor', title: 'Script Editor' },
  { description: 'Edit entities, components, edges, and saves; pause/resume; LLM patches.', href: 'world-editor.html', label: 'Open World Editor', title: 'World Editor' },
  { description: 'Watch the live world event feed with expandable records and entity references.', href: 'event-stream.html', label: 'Open Event Stream', title: 'Event Stream' },
  { description: 'Inspect live Tempo traces or load JSON and JSONL trace artifacts.', href: 'trace-analyzer.html', label: 'Open Trace Analyzer', title: 'Trace Analyzer' },
] as const;

export function ToolLinks({ links }: { links: readonly ToolLink[] }) {
  return <>{links.map((link) => (
    <article class="client-card" data-tool-href={link.href} key={link.href}>
      <h3>{link.title}</h3>
      <p>{link.description}</p>
      <a class="button-link primary" href={link.href}>{link.label}</a>
    </article>
  ))}</>;
}

export function renderToolLinks(root: HTMLElement, links: readonly ToolLink[] = toolLinks) {
  render(<ToolLinks links={links} />, root);
}

const root = document.getElementById('tool-client-grid');
if (root) renderToolLinks(root);
