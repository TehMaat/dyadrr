import { DyadrrError } from './codes.js';

// Scelte dell'utente (studio §10.1). Ogni scelta si fa con un'opzione da riga
// di comando, che vince, o con una variabile d'ambiente che la preimposta;
// altrimenti resta in sospeso e la fa l'utente al momento del merge.

export const CHOICES = {
  tail: {
    option: '--tail',
    env: 'DYADRR_TAIL',
    values: ['trim', 'keep'],
  },
  italian: {
    option: '--italian',
    env: 'DYADRR_ITALIAN',
    values: ['all', 'main'],
  },
  referenceItalianSubs: {
    option: '--reference-italian-subs',
    env: 'DYADRR_REFERENCE_ITALIAN_SUBS',
    values: ['keep', 'drop'],
  },
  edgeMismatch: {
    option: '--edge-mismatch',
    env: 'DYADRR_EDGE_MISMATCH',
    values: ['drop', 'keep'],
  },
} as const;

export type ChoiceName = keyof typeof CHOICES;
export type ChoiceValue<N extends ChoiceName> = (typeof CHOICES)[N]['values'][number];
export type ChoiceOrigin = 'option' | 'env' | 'prompt';

export const CHOICE_NAMES = Object.keys(CHOICES) as ChoiceName[];

/** Valori indicati per le scelte, ancora da validare. */
export type RawChoices = Partial<Record<ChoiceName, string>>;

/** Valori validati, con la loro origine. */
export type GivenChoices = {
  [N in ChoiceName]?: { value: ChoiceValue<N>; origin: ChoiceOrigin };
};

function validate(name: ChoiceName, value: string, source: string): string {
  const allowed: readonly string[] = CHOICES[name].values;
  if (!allowed.includes(value)) {
    throw new DyadrrError(
      'BAD_ARGUMENTS',
      `${source}: "${value}" is not valid (expected ${allowed.join(' or ')})`,
    );
  }
  return value;
}

/**
 * Valida le scelte indicate da opzioni e variabili d'ambiente. L'opzione vince
 * sulla variabile. Un valore non valido è `BAD_ARGUMENTS` anche se la scelta
 * poi non serve, e anche se un'opzione valida la sovrascrive: un errore di
 * configurazione non deve restare nascosto.
 */
export function readGivenChoices(
  options: RawChoices,
  env: Readonly<Record<string, string | undefined>>,
): GivenChoices {
  const given: Record<string, { value: string; origin: ChoiceOrigin }> = {};
  for (const name of CHOICE_NAMES) {
    const { option, env: envName } = CHOICES[name];
    const envValue = env[envName]?.trim();
    const fromEnv = envValue ? validate(name, envValue, envName) : undefined;
    const optionValue = options[name];
    const fromOption = optionValue !== undefined ? validate(name, optionValue, option) : undefined;
    if (fromOption !== undefined) given[name] = { value: fromOption, origin: 'option' };
    else if (fromEnv !== undefined) given[name] = { value: fromEnv, origin: 'env' };
  }
  return given as GivenChoices;
}

export type ChoiceState =
  | { name: ChoiceName; needed: true; status: 'decided'; value: string; origin: ChoiceOrigin }
  | { name: ChoiceName; needed: true; status: 'pending' }
  | { name: ChoiceName; needed: false; status: 'ignored'; value: string; origin: ChoiceOrigin }
  | { name: ChoiceName; needed: false; status: 'not-needed' };

/**
 * Incrocia le scelte indicate con quelle che servono per questa coppia (le
 * calcola l'analisi). Una scelta indicata ma non necessaria si ignora e il
 * report lo dice; una necessaria e non indicata resta in sospeso.
 */
export function resolveChoices(
  needed: ReadonlySet<ChoiceName>,
  given: GivenChoices,
): ChoiceState[] {
  return CHOICE_NAMES.map((name): ChoiceState => {
    const g = given[name];
    if (needed.has(name)) {
      return g
        ? { name, needed: true, status: 'decided', value: g.value, origin: g.origin }
        : { name, needed: true, status: 'pending' };
    }
    return g
      ? { name, needed: false, status: 'ignored', value: g.value, origin: g.origin }
      : { name, needed: false, status: 'not-needed' };
  });
}

export function pendingChoices(states: readonly ChoiceState[]): ChoiceName[] {
  return states.filter((s) => s.status === 'pending').map((s) => s.name);
}

/**
 * Per il merge: senza un terminale per chiedere, una scelta necessaria in
 * sospeso ferma tutto con `CHOICE_REQUIRED`, prima di scrivere qualsiasi cosa.
 */
export function assertNoPendingChoices(states: readonly ChoiceState[]): void {
  const pending = pendingChoices(states);
  if (pending.length > 0) {
    const list = pending
      .map((name) => `${CHOICES[name].option} ${CHOICES[name].values.join('|')}`)
      .join(', ');
    throw new DyadrrError('CHOICE_REQUIRED', `a choice is required for this pair: ${list}`);
  }
}
