import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8');

describe('manifest', () => {
  it('keeps the Forge app id, the Jira and Confluence modules, and the Teamwork Graph scopes', () => {
    expect(manifest).toContain('id: ari:cloud:ecosystem::app/689d38fb-0df1-46ef-8f81-be74c1ad79c2');
    expect(manifest).toContain('jira:globalPage:');
    expect(manifest).toContain('jira:issuePanel:');
    expect(manifest).toContain('confluence:globalPage:');
    expect(manifest).toContain('read:graph:user:atlassian');
    expect(manifest).toContain('read:graph:issue:jira');
    expect(manifest).toContain('read:graph:page:confluence');
  });

  it('does not declare a Rovo module', () => {
    expect(manifest).not.toMatch(/rovo/i);
  });
});
