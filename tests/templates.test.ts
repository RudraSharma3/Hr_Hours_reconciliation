import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/lib/templates';

describe('renderTemplate', () => {
  it('substitutes known placeholders', () => {
    const out = renderTemplate('Hi {{name}}, your total is {{amount}}.', { name: 'Amit', amount: 16 });
    expect(out).toBe('Hi Amit, your total is 16.');
  });

  it('leaves unknown placeholders untouched', () => {
    const out = renderTemplate('Hi {{name}}, {{unknown}}.', { name: 'Amit' });
    expect(out).toBe('Hi Amit, {{unknown}}.');
  });

  it('handles whitespace inside braces', () => {
    const out = renderTemplate('{{  name  }}', { name: 'Amit' });
    expect(out).toBe('Amit');
  });
});
