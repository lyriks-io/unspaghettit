import { NBSP } from '$shared/language';
import type { Prover, VerdictProof } from './ProverPort';

/**
 * What stands in for a proof module that was asked for and did not load (not
 * installed, or built for another engine contract): every place that would
 * show a proof says, in one line, that the solver did not start and why. It
 * never proves anything and offers no tool.
 */
export const unavailableProver = (module: string, reason: string): Prover => {
  const sentence = `The solver did not start: ${reason}`;
  const verdict: VerdictProof = {
    ran: false,
    provenViolations: 0,
    unsettled: 0,
    witnessedInputs: new Map(),
    explorationPlan: { run: true, reasons: ['the solver did not start'] },
    checks: ({ thresholds }) => ({
      searches: [],
      closing: [
        {
          id: 'solver',
          label: 'Solver',
          status: thresholds.failOnOpenProofs ? 'fail' : 'warn',
          detail: `${reason}: nothing was proven`
        }
      ]
    })
  };
  return {
    name: module,
    version: '',
    kernelApi: -1,
    attach: () => undefined,
    storeProofsIn: () => undefined,
    status: () => ({ kind: 'none', reason }),
    verdictProof: async () => verdict,
    specGaps: async (feature, { language }) => ({
      gaps: [
        {
          code: 'solver-unavailable',
          severity: 'recommended',
          entityType: 'feature',
          entityId: String(feature.id),
          entityName: feature.name,
          reason:
            language === 'fr'
              ? `Le solveur n'a pas démarré (${reason}), donc rien n'a été prouvé${NBSP}: les points ci-dessous ne viennent que des vérifications structurelles.`
              : `${sentence}, so nothing was proven: the gaps below come from the structural checks alone.`,
          suggestedFix:
            language === 'fr'
              ? "Installez le module de preuve fait pour cette version du moteur, puis relisez les points."
              : 'Install the proof module built for this engine version, then read the gaps again.'
        }
      ],
      proof: { solver: 'unavailable', reason: sentence }
    }),
    explorationAid: async () => ({
      witnessedInputs: new Map(),
      readout: { solver: 'unavailable', reason: sentence },
      solverInputs: { unavailable: sentence }
    }),
    tools: () => [],
    shutdown: () => undefined
  };
};
