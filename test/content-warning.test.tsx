import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { contentFlagsFromResource, ignoredContentFlags, useContentWarningGate } from '../src/content-warning';

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
    await waitFor(() => expect(joined).toHaveBeenCalledOnce());
    fireEvent.click(view.getByText('Join'));
    await waitFor(() => expect(joined).toHaveBeenCalledTimes(2));
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
    await waitFor(() => expect(joined).toHaveBeenCalledOnce());
  });

  it('remembers accepted flags and leaves fetch failures closed', async () => {
    const joined = vi.fn();
    const fetcher = vi.fn(async () => world(['adult:violence']));
    const view = render(<Harness fetcher={fetcher} joined={joined} />);

    fireEvent.click(view.getByText('Join'));
    fireEvent.click(await view.findByLabelText(/Ignore these flags/));
    fireEvent.click(view.getByText('Accept and Join'));
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
});
