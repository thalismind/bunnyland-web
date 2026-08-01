import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  contentFlagsFromResource,
  hasWorldIntroduction,
  ignoredContentFlags,
  useContentWarningGate,
} from '../src/content-warning';

function Harness({ fetcher, joined }: {
  fetcher: (base: string) => Promise<unknown>;
  joined: () => void;
}) {
  const gate = useContentWarningGate(fetcher);
  return <>
    <button onClick={() => { void gate.requireAcceptance('/api').then(accepted => { if (accepted) joined(); }).catch(() => undefined); }}>Join</button>
    <button onClick={() => { void gate.requireAcceptance('/other').then(accepted => { if (accepted) joined(); }).catch(() => undefined); }}>Join other</button>
    {gate.warningDialog}
  </>;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>(resolve => { resolvePromise = resolve; });
  return { promise, resolve: value => resolvePromise?.(value) };
}

function world(contentFlags: string[]) {
  return {
    world_id: 'world-1', world_epoch: 1, title: 'Clover City', description: '', content_flags: contentFlags,
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('content warning gate', () => {
  it('normalizes the typed world resource and blocks joining until acceptance', async () => {
    const joined = vi.fn();
    const view = render(<Harness
      fetcher={async () => ({
        world_id: 'world-1',
        world_epoch: 1,
        title: 'Clover City',
        description: 'Mind the foxes after dark.',
        content_flags: ['pvp', 'adult:violence', 'pvp'],
      })}
      joined={joined}
    />);

    fireEvent.click(view.getByText('Join'));
    expect(await view.findByRole('dialog')).toBeTruthy();
    expect(view.getByText('adult:violence')).toBeTruthy();
    expect(joined).not.toHaveBeenCalled();

    fireEvent.click(view.getByLabelText(/Ignore these flags/));
    fireEvent.click(view.getByText('Accept and Join'));
    expect(await view.findByRole('dialog', { name: 'Clover City' })).toBeTruthy();
    expect(view.getByText('Mind the foxes after dark.')).toBeTruthy();
    expect(joined).not.toHaveBeenCalled();
    fireEvent.click(view.getByText('Continue'));
    await waitFor(() => expect(joined).toHaveBeenCalledOnce());
    expect(ignoredContentFlags()).toEqual(['adult:violence', 'pvp']);
  });

  it('declines without joining and accepts empty or already accepted flag sets', async () => {
    const joined = vi.fn();
    const fetcher = vi.fn(async () => ({
      world_id: 'world-1',
      world_epoch: 1,
      title: 'Clover City',
      description: '',
      content_flags: ['theft'],
    }));
    const view = render(<Harness fetcher={fetcher} joined={joined} />);

    fireEvent.click(view.getByText('Join'));
    fireEvent.click(await view.findByText('Leave'));
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
    expect(joined).not.toHaveBeenCalled();

    fetcher.mockResolvedValue({
      world_id: 'world-1', world_epoch: 1, title: 'Clover City', description: '', content_flags: [],
    });
    fireEvent.click(view.getByText('Join'));
    expect(await view.findByRole('dialog', { name: 'Clover City' })).toBeTruthy();
    fireEvent.click(view.getByText('Continue'));
    await waitFor(() => expect(joined).toHaveBeenCalledOnce());
    fireEvent.click(view.getByText('Join'));
    await waitFor(() => expect(joined).toHaveBeenCalledTimes(2));
  });

  it('enters immediately when all entry content is empty or ignored', async () => {
    const joined = vi.fn();
    const fetcher = vi.fn(async () => ({
      ...world(['adult:violence']), title: '  ', description: '\n',
    }));
    localStorage.setItem('bunnyland.contentFlags.ignore', JSON.stringify(['adult:violence']));
    const view = render(<Harness fetcher={fetcher} joined={joined} />);

    fireEvent.click(view.getByText('Join'));
    await waitFor(() => expect(joined).toHaveBeenCalledOnce());
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('continues directly after accepting a warning when the introduction is empty', async () => {
    const joined = vi.fn();
    const view = render(<Harness
      fetcher={async () => ({
        ...world(['adult:violence']), title: '', description: '',
      })}
      joined={joined}
    />);

    fireEvent.click(view.getByText('Join'));
    fireEvent.click(await view.findByText('Accept and Join'));
    await waitFor(() => expect(joined).toHaveBeenCalledOnce());
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('shows introductions with either a title or a description', () => {
    expect(hasWorldIntroduction({
      contentFlags: [], description: '', title: 'Clover City', worldEpoch: 1, worldId: 'world-1',
    })).toBe(true);
    expect(hasWorldIntroduction({
      contentFlags: [], description: 'Welcome.', title: '', worldEpoch: 1, worldId: 'world-1',
    })).toBe(true);
    expect(hasWorldIntroduction({
      contentFlags: [], description: '\n', title: '  ', worldEpoch: 1, worldId: 'world-1',
    })).toBe(false);
  });

  it('rejects malformed resource shapes and flags', () => {
    expect(() => contentFlagsFromResource(null)).toThrow('invalid public world');
    expect(() => contentFlagsFromResource({ content_flags: 'pvp' })).toThrow('invalid public world');
    expect(() => contentFlagsFromResource({
      world_id: 'world-1', world_epoch: 1, title: 'Clover City', description: '', content_flags: ['Not Valid'],
    })).toThrow('invalid public world');
    expect(() => contentFlagsFromResource({
      world_id: 'world-1', world_epoch: 1, title: 4, description: '', content_flags: [],
    })).toThrow('invalid public world');
    expect(() => contentFlagsFromResource({
      world_id: 'world-1', world_epoch: 1, title: 'Clover City', description: null, content_flags: [],
    })).toThrow('invalid public world');
  });

  it('ignores stale requests during rapid server reselection', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const joined = vi.fn();
    const fetcher = vi.fn((base: string) => base === '/api' ? first.promise : second.promise);
    const view = render(<Harness fetcher={fetcher} joined={joined} />);

    fireEvent.click(view.getByText('Join'));
    fireEvent.click(view.getByText('Join other'));
    second.resolve(world(['adult:violence']));
    expect(await view.findByText('adult:violence')).toBeTruthy();
    first.resolve(world(['theft']));
    await Promise.resolve();
    expect(view.queryByText('theft')).toBeNull();
    expect(joined).not.toHaveBeenCalled();

    fireEvent.click(view.getByText('Accept and Join'));
    expect(await view.findByRole('dialog', { name: 'Clover City' })).toBeTruthy();
    fireEvent.click(view.getByText('Continue'));
    await waitFor(() => expect(joined).toHaveBeenCalledOnce());
  });

  it('remembers accepted flags and leaves fetch failures closed', async () => {
    const joined = vi.fn();
    const fetcher = vi.fn(async () => world(['adult:violence']));
    const view = render(<Harness fetcher={fetcher} joined={joined} />);

    fireEvent.click(view.getByText('Join'));
    fireEvent.click(await view.findByLabelText(/Ignore these flags/));
    fireEvent.click(view.getByText('Accept and Join'));
    fireEvent.click(await view.findByText('Continue'));
    await waitFor(() => expect(joined).toHaveBeenCalledOnce());
    fireEvent.click(view.getByText('Join'));
    await waitFor(() => expect(joined).toHaveBeenCalledTimes(2));
    expect(view.queryByRole('dialog')).toBeNull();

    fetcher.mockRejectedValue(new Error('offline'));
    fireEvent.click(view.getByText('Join other'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(joined).toHaveBeenCalledTimes(2);
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('persists world/server and global introduction skip choices independently', async () => {
    const joined = vi.fn();
    const fetcher = vi.fn(async () => world([]));
    const first = render(<Harness fetcher={fetcher} joined={joined} />);

    fireEvent.click(first.getByText('Join'));
    fireEvent.click(await first.findByLabelText(/this world and server/));
    fireEvent.click(first.getByText('Continue'));
    await waitFor(() => expect(joined).toHaveBeenCalledOnce());
    first.unmount();

    const second = render(<Harness fetcher={fetcher} joined={joined} />);
    fireEvent.click(second.getByText('Join'));
    await waitFor(() => expect(joined).toHaveBeenCalledTimes(2));
    expect(second.queryByRole('dialog')).toBeNull();

    fireEvent.click(second.getByText('Join other'));
    expect(await second.findByRole('dialog', { name: 'Clover City' })).toBeTruthy();
    fireEvent.click(second.getByLabelText(/all worlds and servers/));
    fireEvent.click(second.getByText('Continue'));
    await waitFor(() => expect(joined).toHaveBeenCalledTimes(3));
    second.unmount();

    const third = render(<Harness fetcher={fetcher} joined={joined} />);
    fireEvent.click(third.getByText('Join other'));
    await waitFor(() => expect(joined).toHaveBeenCalledTimes(4));
    expect(third.queryByRole('dialog')).toBeNull();
  });
});
