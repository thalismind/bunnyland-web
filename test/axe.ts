import axe from 'axe-core';
import { expect } from 'vitest';

export async function expectNoSeriousAxeIssues(container: HTMLElement): Promise<void> {
  const result = await axe.run(container, {
    rules: {
      'color-contrast': { enabled: false },
    },
  });
  const violations = result.violations
    .filter(violation => violation.impact === 'serious' || violation.impact === 'critical')
    .map(violation => `${violation.id}: ${violation.nodes.map(node => node.target.join(' ')).join(', ')}`);
  expect(violations).toEqual([]);
}
