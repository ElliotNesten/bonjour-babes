import { docKeyOf, isValidKey } from '../src/lib/backend/protocol.js';
import { getAt, isPlainObject } from '../src/lib/backend/tree.js';
import { splitPath } from '../src/lib/backend/types.js';

/**
 * Databasens säkerhetsregler – samma regler som tidigare låg i database.rules.json (Firebase), nu i
 * TypeScript, med samma semantik som Firebase Realtime Database:
 *
 *  - .read/.write "kaskaderar": en läsning/skrivning på en sökväg är tillåten om regeln på sökvägen
 *    eller på NÅGON nivå ovanför ger true. En djupare regel kan inte ta bort en rättighet.
 *  - .validate kaskaderar inte. Den körs för varje nod som inte är null i de NYA datat på de
 *    skrivna platserna och alla noder under dem, och för varje nivå ovanför upp till roten (med
 *    det sammanslagna nya datat). Alla måste ge true. Borttagningar (null) valideras inte.
 *  - Namngivna barn går före $jokrar. "$other": { ".validate": false } nekar okända nycklar.
 *  - En fler-sökvägsuppdatering godkänns bara om ALLA sökvägar godkänns.
 *  - Kastar en regel ett fel räknas den som false (som i Firebase).
 *
 * Kontext i reglerna: auth ({ uid } eller null), root (gamla datat), data (gamla datat på regelns
 * nivå), newData (nya datat på regelns nivå), vars ($-jokrarnas värden) och now (serverns tid).
 */

/* ------------------------------------------------------------------ */
/*  Typer                                                               */
/* ------------------------------------------------------------------ */

export type Auth = { uid: string } | null;

export interface RuleContext {
  auth: Auth;
  /** Gamla datat i roten. */
  root: Snapshot;
  /** Gamla datat på regelns nivå. */
  data: Snapshot;
  /** Nya datat på regelns nivå (vid läsning: samma som data). */
  newData: Snapshot;
  /** Värdena på $-jokrarna längs sökvägen, t.ex. vars.$gameId. */
  vars: Readonly<Record<string, string>>;
  now: number;
}

export type RuleFn = (ctx: RuleContext) => boolean;
export type Rule = boolean | RuleFn;

export interface RuleNode {
  '.read'?: Rule;
  '.write'?: Rule;
  '.validate'?: Rule;
  [child: string]: RuleNode | Rule | undefined;
}

/** Reglerna behöver ett dokument som inte är inläst. Läs in det och kör kontrollen igen. */
export class NeedDocsError extends Error {
  constructor(readonly keys: string[]) {
    super(`Reglerna behöver dokumenten ${keys.join(', ')}`);
    this.name = 'NeedDocsError';
  }
}

/** En regel försöker läsa något som servern inte stöder (t.ex. en hel samling). Ett fel i reglerna. */
export class UnsupportedRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedRuleError';
  }
}

/** Ger värdet på en sökväg (null om den saknas). Får kasta NeedDocsError/UnsupportedRuleError. */
export type DataSource = (segs: readonly string[]) => unknown;

/* ------------------------------------------------------------------ */
/*  Snapshot (som RuleDataSnapshot i Firebase)                          */
/* ------------------------------------------------------------------ */

export class Snapshot {
  constructor(
    private readonly source: DataSource,
    readonly segs: readonly string[],
  ) {}

  val(): unknown {
    return this.source(this.segs);
  }
  exists(): boolean {
    return this.val() !== null;
  }
  child(path: string): Snapshot {
    return new Snapshot(this.source, [...this.segs, ...splitPath(path)]);
  }
  parent(): Snapshot {
    if (!this.segs.length) throw new Error('Roten har ingen förälder');
    return new Snapshot(this.source, this.segs.slice(0, -1));
  }
  hasChild(path: string): boolean {
    return this.child(path).exists();
  }
  /** Utan argument: om noden har några barn alls. Med: om den har alla de angivna barnen. */
  hasChildren(keys?: readonly string[]): boolean {
    const v = this.val();
    if (!isPlainObject(v) && !Array.isArray(v)) return false;
    return keys ? keys.every((k) => this.hasChild(k)) : true;
  }
  isString(): boolean {
    return typeof this.val() === 'string';
  }
  isNumber(): boolean {
    return typeof this.val() === 'number';
  }
  isBoolean(): boolean {
    return typeof this.val() === 'boolean';
  }
}

/** Datakälla över inlästa dokument (nyckel → data, null = saknas). */
export function docSource(docs: ReadonlyMap<string, unknown>): DataSource {
  return (segs) => {
    const key = docKeyOf(segs.join('/'));
    if (key === null) throw new UnsupportedRuleError(`Reglerna kan inte läsa "${segs.join('/')}" (ovanför dokumentnivå)`);
    if (!docs.has(key)) throw new NeedDocsError([key]);
    return getAt(docs.get(key) ?? null, segs.slice(splitPath(key).length));
  };
}

/** Datakälla för läsregler, som inte får titta på datat. */
const noDataSource: DataSource = () => {
  throw new UnsupportedRuleError('Läsreglerna kan inte läsa data');
};

/* ------------------------------------------------------------------ */
/*  Reglerna (från database.rules.json)                                 */
/* ------------------------------------------------------------------ */

/** Inloggad admin: har en session vars hash är samma som det aktuella adminlösenordets hash. */
const isAdmin: RuleFn = ({ auth, root }) => {
  if (auth === null) return false;
  const session = root.child('adminSessions').child(auth.uid);
  return session.exists() && session.val() === root.child('secret').child('adminHash').val();
};

const str = (s: Snapshot): string | null => {
  const v = s.val();
  return typeof v === 'string' ? v : null;
};

const strLength = (min: number, max: number): RuleFn => ({ newData }) => {
  const v = str(newData);
  return v !== null && v.length >= min && v.length <= max;
};

const isNumber: RuleFn = ({ newData }) => newData.isNumber();

/** Betyg 1–10, heltal. */
const score: RuleFn = ({ newData }) => {
  const v = newData.val();
  return typeof v === 'number' && v >= 1 && v <= 10 && v % 1 === 0;
};

const gameOf = (ctx: RuleContext) => ctx.root.child('games').child(ctx.vars.$gameId);

export const RULES: RuleNode = {
  '.read': false,
  '.write': false,

  setup: {
    '.read': true,
    adminConfigured: {
      '.write': ({ auth, data, newData }) =>
        auth !== null && !data.exists() && newData.parent().parent().child('secret').child('adminHash').exists(),
      '.validate': ({ newData }) => newData.val() === true,
    },
    $other: { '.validate': false },
  },

  secret: {
    adminHash: {
      '.write': ({ auth, data, newData }) =>
        auth !== null && !data.exists() && newData.parent().parent().child('setup').child('adminConfigured').val() === true,
      '.validate': ({ newData }) => {
        const v = str(newData);
        return v !== null && /^[0-9a-f]{64}$/.test(v);
      },
    },
    $other: { '.validate': false },
  },

  adminSessions: {
    $uid: {
      '.read': ({ auth, vars }) => auth !== null && auth.uid === vars.$uid,
      '.write': ({ auth, vars }) => auth !== null && auth.uid === vars.$uid,
      '.validate': ({ newData, root }) => {
        const hash = root.child('secret').child('adminHash');
        return newData.isString() && hash.exists() && newData.val() === hash.val();
      },
    },
  },

  pins: {
    '.read': true,
    $pin: {
      '.write': isAdmin,
      '.validate': ({ newData, vars }) => /^[0-9]{6}$/.test(vars.$pin) && newData.isString(),
    },
  },

  hallOfFame: {
    '.read': true,
    $gameId: {
      '.write': isAdmin,
    },
  },

  games: {
    '.read': true,
    $gameId: {
      '.write': isAdmin,

      players: {
        $pid: {
          '.write': (ctx) => {
            const { auth, data, vars } = ctx;
            if (auth === null || auth.uid !== vars.$pid) return false;
            const game = gameOf(ctx);
            if (!game.child('meta').exists()) return false;
            const status = game.child('meta/status').val();
            return status === 'lobby' || status === 'running' || data.exists();
          },
          '.validate': ({ newData }) => newData.hasChildren(['name', 'drink', 'emoji', 'color', 'joinedAt']),
          name: { '.validate': strLength(1, 24) },
          drink: { '.validate': strLength(1, 40) },
          emoji: { '.validate': strLength(1, 16) },
          color: {
            '.validate': ({ newData }) => {
              const v = str(newData);
              return v !== null && /^#[0-9a-fA-F]{6}$/.test(v);
            },
          },
          joinedAt: { '.validate': isNumber },
          manual: { '.validate': ({ newData }) => newData.isBoolean() },
          $other: { '.validate': false },
        },
      },

      votes: {
        $drinkId: {
          $voterId: {
            '.write': (ctx) => {
              const { auth, vars } = ctx;
              if (auth === null || auth.uid !== vars.$voterId || vars.$drinkId === vars.$voterId) return false;
              const game = gameOf(ctx);
              return (
                game.child('players').child(vars.$voterId).exists() &&
                game.child('meta/status').val() === 'running' &&
                game.child('current/drinkId').val() === vars.$drinkId &&
                game.child('current/phase').val() === 'voting'
              );
            },
            '.validate': ({ newData }) => newData.hasChildren(['taste', 'look', 'creativity', 'again', 'at']),
            taste: { '.validate': score },
            look: { '.validate': score },
            creativity: { '.validate': score },
            again: { '.validate': score },
            comment: { '.validate': strLength(0, 280) },
            at: { '.validate': isNumber },
            $other: { '.validate': false },
          },
        },
      },

      awardVotes: {
        $awardId: {
          $voterId: {
            '.write': (ctx) => {
              const { auth, vars } = ctx;
              if (auth === null || auth.uid !== vars.$voterId) return false;
              const game = gameOf(ctx);
              return game.child('players').child(vars.$voterId).exists() && game.child('meta/status').val() === 'awards';
            },
            '.validate': (ctx) => {
              const { newData, vars } = ctx;
              const target = str(newData);
              return (
                ['name', 'daring', 'swamp', 'favorite'].includes(vars.$awardId) &&
                target !== null &&
                target !== vars.$voterId &&
                // (skärpning mot Firebase-versionen: målet måste vara en giltig nyckel, inte t.ex. "" eller "a/b")
                isValidKey(target) &&
                gameOf(ctx).child('players').child(target).exists()
              );
            },
          },
        },
      },
    },
  },
};

/* ------------------------------------------------------------------ */
/*  Motorn                                                              */
/* ------------------------------------------------------------------ */

function asNode(v: RuleNode | Rule | undefined): RuleNode | undefined {
  return v !== null && typeof v === 'object' ? v : undefined;
}

/** Regelnoden för ett barn: namngivet barn i första hand, annars $jokern (vars får då ett värde). */
function childRule(node: RuleNode | undefined, seg: string, vars: Record<string, string>): RuleNode | undefined {
  if (!node) return undefined;
  if (!seg.startsWith('.') && !seg.startsWith('$') && Object.prototype.hasOwnProperty.call(node, seg)) {
    const named = asNode(node[seg]);
    if (named) return named;
  }
  for (const key of Object.keys(node)) {
    if (key.startsWith('$')) {
      vars[key] = seg;
      return asNode(node[key]);
    }
  }
  return undefined;
}

/** Kör en regel. Fel räknas som false, utom de som betyder "läs in mer" eller "fel i reglerna". */
function evaluate(rule: Rule | undefined, ctx: () => RuleContext): boolean {
  if (rule === undefined) return false;
  if (typeof rule === 'boolean') return rule;
  try {
    return rule(ctx()) === true;
  } catch (err) {
    if (err instanceof NeedDocsError || err instanceof UnsupportedRuleError) throw err;
    return false;
  }
}

function ruleOf(node: RuleNode | undefined, kind: '.read' | '.write' | '.validate'): Rule | undefined {
  const r = node?.[kind];
  return typeof r === 'boolean' || typeof r === 'function' ? r : undefined;
}

/** Får auth läsa sökvägen? (någon .read från roten ner till sökvägen ger true) */
export function canRead(segs: readonly string[], auth: Auth, rules: RuleNode = RULES, now = Date.now()): boolean {
  const vars: Record<string, string> = {};
  let node: RuleNode | undefined = rules;
  const snap = (depth: number) => new Snapshot(noDataSource, segs.slice(0, depth));
  for (let depth = 0; node; depth++) {
    const ctx = () => ({ auth, root: snap(0), data: snap(depth), newData: snap(depth), vars: { ...vars }, now });
    if (evaluate(ruleOf(node, '.read'), ctx)) return true;
    if (depth === segs.length) break;
    node = childRule(node, segs[depth], vars);
  }
  return false;
}

export interface WriteCheck {
  auth: Auth;
  /** De skrivna platserna (sökvägar som segment), utan överlapp. */
  locations: readonly (readonly string[])[];
  oldRoot: DataSource;
  newRoot: DataSource;
  now: number;
}

export type WriteVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Kontrollerar en skrivning (set/update/remove) mot reglerna: .write för varje plats, sedan
 * .validate. Kastar NeedDocsError om ett dokument som reglerna behöver inte är inläst.
 */
export function checkWrite(input: WriteCheck, rules: RuleNode = RULES): WriteVerdict {
  const { auth, locations, now } = input;
  const ctxAt = (segs: readonly string[], vars: Record<string, string>) => (): RuleContext => ({
    auth,
    root: new Snapshot(input.oldRoot, []),
    data: new Snapshot(input.oldRoot, segs),
    newData: new Snapshot(input.newRoot, segs),
    vars: { ...vars },
    now,
  });

  // 1. .write: någon nivå från roten ner till platsen måste ge true.
  for (const loc of locations) {
    const vars: Record<string, string> = {};
    let node: RuleNode | undefined = rules;
    let granted = false;
    for (let depth = 0; node; depth++) {
      if (evaluate(ruleOf(node, '.write'), ctxAt(loc.slice(0, depth), vars))) {
        granted = true;
        break;
      }
      if (depth === loc.length) break;
      node = childRule(node, loc[depth], vars);
    }
    if (!granted) return { ok: false, reason: `.write nekar "${loc.join('/')}"` };
  }

  // 2. .validate på nivåerna ovanför platserna (med det sammanslagna nya datat) …
  const visited = new Set<string>();
  for (const loc of locations) {
    const vars: Record<string, string> = {};
    let node: RuleNode | undefined = rules;
    for (let depth = 0; node && depth < loc.length; depth++) {
      const segs = loc.slice(0, depth);
      const id = segs.join('/');
      const rule = ruleOf(node, '.validate');
      if (rule !== undefined && !visited.has(id)) {
        visited.add(id);
        const ctx = ctxAt(segs, vars);
        if (new Snapshot(input.newRoot, segs).exists() && !evaluate(rule, ctx)) {
          return { ok: false, reason: `.validate nekar "${id}"` };
        }
      }
      node = childRule(node, loc[depth], vars);
    }
    // … och på platsen och allt under den.
    if (node) {
      const failed = validateTree(node, [...loc], vars, input.newRoot, ctxAt);
      if (failed !== null) return { ok: false, reason: `.validate nekar "${failed}"` };
    }
  }
  return { ok: true };
}

/** Validerar en nod i det nya datat och alla noder under den. Returnerar sökvägen som nekades, eller null. */
function validateTree(
  node: RuleNode,
  segs: string[],
  vars: Record<string, string>,
  newRoot: DataSource,
  ctxAt: (segs: readonly string[], vars: Record<string, string>) => () => RuleContext,
): string | null {
  const value = newRoot(segs);
  if (value === null || value === undefined) return null;
  const rule = ruleOf(node, '.validate');
  if (rule !== undefined && !evaluate(rule, ctxAt(segs, vars))) return segs.join('/');
  const children = isPlainObject(value) ? Object.keys(value) : Array.isArray(value) ? value.map((_, i) => String(i)) : [];
  for (const key of children) {
    const childVars = { ...vars };
    const child = childRule(node, key, childVars);
    if (!child) continue;
    const failed = validateTree(child, [...segs, key], childVars, newRoot, ctxAt);
    if (failed !== null) return failed;
  }
  return null;
}
