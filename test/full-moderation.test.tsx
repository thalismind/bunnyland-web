import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ModerationPage,
  canonicalIdentity,
  durationToSeconds,
} from '../src/moderation/page';

afterEach(() => cleanup());

const players = {
  players: [{
    admin: false,
    claims: [{ character_id: 'character:1', character_name: 'Juniper', claim_id: 'claim-1' }],
    identity: { id: '123', kind: 'discord' },
    restriction: null,
  }],
};

describe('Player moderation', () => {
  it('converts every supported positive duration without a product maximum', () => {
    expect(durationToSeconds(30, 'seconds')).toBe(30);
    expect(durationToSeconds(15, 'minutes')).toBe(900);
    expect(durationToSeconds(2, 'hours')).toBe(7200);
    expect(durationToSeconds(7, 'days')).toBe(604800);
    expect(durationToSeconds(4, 'weeks')).toBe(2419200);
    expect(() => durationToSeconds(0, 'days')).toThrow(/positive whole number/);
    expect(canonicalIdentity({ id: 'alice', kind: 'web' })).toBe('web:alice');
  });

  it('searches players, accepts explicit targets, confirms mutations, and refreshes history', async () => {
    const request = vi.fn(async (_base: string, path: string, _auth?: unknown, init?: RequestInit) => {
      if (path.startsWith('/admin/moderation/players')) return players;
      if (path.startsWith('/admin/moderation/actions?')) return { actions: [] };
      if (path === '/admin/moderation/actions' && init?.method === 'POST') {
        return { id: 'audit-1' };
      }
      throw new Error(`unexpected request ${path}`);
    });
    const confirmAction = vi.fn(async () => true);
    const view = render(<ModerationPage base="/api/v1" confirmAction={confirmAction} request={request} />);
    await view.findByText('Juniper');

    fireEvent.input(view.getByLabelText('Search:'), { target: { value: 'juniper' } });
    expect(view.getByText('Juniper')).toBeTruthy();
    fireEvent.click(view.getByRole('option', { name: /discord:123/ }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      '/api/v1',
      expect.stringContaining('target_kind=discord'),
    ));
    fireEvent.input(view.getByLabelText('Required reason'), { target: { value: 'Repeated spam' } });
    fireEvent.click(view.getByRole('button', { name: 'Ban' }));
    await waitFor(() => expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining('discord:123')));
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      '/api/v1',
      '/admin/moderation/actions',
      {},
      expect.objectContaining({ method: 'POST' }),
    ));
    const mutation = request.mock.calls.find(call => call[1] === '/admin/moderation/actions')?.[3];
    expect(JSON.parse(String(mutation?.body))).toEqual({
      action: 'ban',
      reason: 'Repeated spam',
      target: { id: '123', kind: 'discord' },
    });

    fireEvent.change(view.getByLabelText('Identity platform'), { target: { value: 'web' } });
    fireEvent.input(view.getByLabelText('Identity ID'), { target: { value: 'known-subject' } });
    fireEvent.click(view.getByRole('button', { name: 'Use explicit identity' }));
    await waitFor(() => expect(view.getByText('web:known-subject')).toBeTruthy());
  });

  it('requires a reason and reports server failures accessibly', async () => {
    const request = vi.fn(async (_base: string, path: string) => {
      if (path.startsWith('/admin/moderation/players')) return players;
      if (path.startsWith('/admin/moderation/actions?')) return { actions: [] };
      throw new Error('server refused moderation');
    });
    const view = render(<ModerationPage base="/api/v1" request={request} confirmAction={async () => true} />);
    await view.findByText('Juniper');
    fireEvent.click(view.getByRole('option', { name: /discord:123/ }));
    fireEvent.click(view.getByRole('button', { name: 'Kick' }));
    expect(view.getByRole('alert').textContent).toMatch(/reason is required/i);
    fireEvent.input(view.getByLabelText('Required reason'), { target: { value: 'reason' } });
    fireEvent.click(view.getByRole('button', { name: 'Kick' }));
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('server refused'));
  });
});
