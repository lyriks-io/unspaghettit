import { describe, expect, it } from 'vitest';
import {
  parseScenarioResults,
  scenarioTitleToken,
  summarizeByAction
} from '../results';

const report = {
  testResults: [
    {
      assertionResults: [
        { title: `${scenarioTitleToken('s1', 'a1', 'sc1')} happy path`, status: 'passed' },
        { title: `${scenarioTitleToken('s1', 'a1', 'sc2')} sad path`, status: 'failed' },
        { title: `${scenarioTitleToken('s1', 'a2', 'sc3')} other`, status: 'passed' },
        { title: 'a plain user test with no token', status: 'passed' }
      ]
    }
  ]
};

describe('parseScenarioResults', () => {
  it('extracts only unspa-tokened tests, with pass/fail', () => {
    const results = parseScenarioResults(report);
    expect(results).toEqual([
      { surfaceId: 's1', actionId: 'a1', scenarioId: 'sc1', passed: true },
      { surfaceId: 's1', actionId: 'a1', scenarioId: 'sc2', passed: false },
      { surfaceId: 's1', actionId: 'a2', scenarioId: 'sc3', passed: true }
    ]);
  });

  it('tolerates a malformed report', () => {
    expect(parseScenarioResults(null)).toEqual([]);
    expect(parseScenarioResults({})).toEqual([]);
    expect(parseScenarioResults({ testResults: [{}] })).toEqual([]);
  });
});

describe('summarizeByAction', () => {
  it('marks an action verified only when every scenario passed', () => {
    const summary = summarizeByAction(parseScenarioResults(report));
    const a1 = summary.find((a) => a.actionId === 'a1');
    const a2 = summary.find((a) => a.actionId === 'a2');
    expect(a1).toMatchObject({ total: 2, passed: 1, verified: false });
    expect(a2).toMatchObject({ total: 1, passed: 1, verified: true });
  });
});
