// Codici fissi del contratto (studio §11–12). Ogni rifiuto, errore e avviso
// ha un codice; chi chiama decide solo dal campo `decision` del report.

export const REFUSAL_CODES = [
  'NO_ITALIAN_AUDIO',
  'BOTH_ITALIAN_AUDIO',
  'NO_COMMON_LANGUAGE',
  'DONOR_BETTER_VIDEO',
  'FPS_MISMATCH',
  'PAL_SPEEDUP',
  'NO_MATCH',
  'AMBIGUOUS_MATCH',
  'OFFSET_TOO_LARGE',
  'CHECKPOINT_CONTRADICTION',
  'CHECKPOINT_UNMATCHED',
  'DRIFT',
  'TOO_FEW_CHECKPOINTS',
  'LOW_COVERAGE',
] as const;

export const ERROR_CODES = [
  'BAD_ARGUMENTS',
  'INPUT_UNREADABLE',
  'INPUT_TRUNCATED',
  'INPUT_BUSY',
  'INPUT_CHANGED',
  'CHOICE_REQUIRED',
  'OUTPUT_EXISTS',
  'OUTPUT_NOT_WRITABLE',
  'NO_SPACE',
  'TOOL_MISSING',
  'TOOL_TOO_OLD',
  'MERGE_FAILED',
  'VERIFY_FAILED',
  'INTERNAL',
] as const;

export const WARNING_CODES = [
  'VIDEO_QUALITY_UNCERTAIN',
  'ORIGINAL_LANGUAGE_NOT_COMMON',
  'MEASURE_MIX_DIFFERS',
  'ITALIAN_TRANSFER_OFFSET',
  'ITALIAN_UNVERIFIED',
  'ITALIAN_TRACKS_SKIPPED',
  'REFERENCE_HAS_ITALIAN_SUBS',
  'ITALIAN_SUBS_NOT_PGS',
  'NO_FORCED_ITALIAN_SUBS',
  'SDR_SUBS_ON_HDR',
  'SUBTITLES_DROPPED_AT_CUT',
  'INTRO_MISMATCH',
  'OUTRO_MISMATCH',
  'LONG_GAP_WITHOUT_ITALIAN',
  'TAIL_EXCESS_KEPT',
  'ABRUPT_START',
  'MANY_INCONCLUSIVE',
  'MKVMERGE_WARNING',
  'OUTPUT_TRANSFER_OFFSET',
  'OUTPUT_TRANSFER_UNVERIFIED',
  'INPUT_NOT_DELETED',
] as const;

export type RefusalCode = (typeof REFUSAL_CODES)[number];
export type ErrorCode = (typeof ERROR_CODES)[number];
export type WarningCode = (typeof WARNING_CODES)[number];

export type Decision = 'eligible' | 'refused' | 'error' | 'cancelled';

// Numeri che Node non usa mai da solo (1, 3–7, 9, 10, 12–14 e >128 sono suoi):
// un crash di Node esce con 1 e non deve sembrare un rifiuto.
export const EXIT_CODES = {
  eligible: 0,
  refused: 20,
  inputError: 30,
  internalError: 40,
  cancelled: 50,
} as const;

// Errori dovuti a ingressi, ambiente o parametri (uscita 30); gli altri
// errori sono interni, di merge o di verifica (uscita 40).
const INPUT_ERRORS: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'BAD_ARGUMENTS',
  'INPUT_UNREADABLE',
  'INPUT_TRUNCATED',
  'INPUT_BUSY',
  'INPUT_CHANGED',
  'CHOICE_REQUIRED',
  'OUTPUT_EXISTS',
  'OUTPUT_NOT_WRITABLE',
  'NO_SPACE',
  'TOOL_MISSING',
  'TOOL_TOO_OLD',
]);

export function exitCodeFor(decision: Decision, errorCode?: ErrorCode): number {
  switch (decision) {
    case 'eligible':
      return EXIT_CODES.eligible;
    case 'refused':
      return EXIT_CODES.refused;
    case 'cancelled':
      return EXIT_CODES.cancelled;
    case 'error':
      return errorCode !== undefined && INPUT_ERRORS.has(errorCode)
        ? EXIT_CODES.inputError
        : EXIT_CODES.internalError;
  }
}

export class DyadrrError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'DyadrrError';
    this.code = code;
  }
}

/**
 * L'annullamento (`CANCELLED`, uscita 50): il motivo con cui si interrompe
 * l'`AbortSignal` dell'analisi o del merge quando arriva un segnale di stop
 * (studio §10). Non è un errore: il report dice `cancelled`.
 */
export class CancelledError extends Error {
  readonly code = 'CANCELLED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'CancelledError';
  }
}
