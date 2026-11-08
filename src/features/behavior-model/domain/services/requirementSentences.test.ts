import { describe, expect, it } from 'vitest';
import {
  actionPhrase,
  conditionText,
  earsOfGoal,
  earsOfInvariant,
  earsOfRule,
  eventClause,
  expressionText,
  featureStatements,
  gwtOfScenario,
  properNamesIn,
  refusalCase,
  refusalLead,
  statesRead,
  actionContextOf,
  earsOfEffect,
  featureConstants,
  featureLanguage,
  readableName
} from './requirementSentences';

const withdraw = { name: 'Withdraw' };
const constants = { DAILY_CAP: 1000, MAX_TOPUP: 5000 };

describe('EARS sentences of rules', () => {
  it('reads a guard on the state as an if, after the action', () => {
    const rule = {
      condition: { left: 'wallet.status', operator: 'equals', right: 'frozen' },
      effect: { type: 'block_action', reason: 'Account frozen' }
    };
    expect(earsOfRule(rule, withdraw)).toBe(
      'When the user asks to withdraw, if the wallet status is "frozen", then the system shall refuse to withdraw and show "Account frozen".'
    );
  });

  it('reads a guard on an input as If ... then, with the value of a named constant', () => {
    const rule = {
      condition: {
        left: { kind: 'param', name: 'amount' },
        operator: 'greater_than',
        right: {
          kind: 'sub',
          left: { kind: 'const', name: 'DAILY_CAP' },
          right: { kind: 'state', path: 'wallet.dailyWithdrawn' }
        }
      },
      effect: { type: 'block_action' }
    };
    expect(earsOfRule(rule, withdraw, constants)).toBe(
      'When the user asks to withdraw, if the amount given is greater than DAILY_CAP (1000) minus the wallet daily withdrawn, then the system shall refuse to withdraw.'
    );
  });

  it('reads state and input together in one if, state first, and a contradiction stays visible', () => {
    const rule = {
      condition: {
        kind: 'all',
        conditions: [
          { left: 'session.role', operator: 'not_equals', right: 'admin' },
          {
            left: { kind: 'param', name: 'amount' },
            operator: 'greater_than',
            right: 2000
          },
          {
            left: { kind: 'param', name: 'amount' },
            operator: 'lower_or_equal',
            right: 1500
          }
        ]
      },
      effect: { type: 'block_action' }
    };
    expect(earsOfRule(rule, withdraw)).toBe(
      'When the user asks to withdraw, if the session role is not "admin", the amount given is greater than 2000 and the amount given is at most 1500, then the system shall refuse to withdraw.'
    );
  });

  it('says who asks: a schedule, the system, or an event', () => {
    const open = { effect: { type: 'allow_action' } };
    expect(earsOfRule(open, { name: 'Reset daily counter', actor: 'schedule' })).toBe(
      'When the schedule asks to reset daily counter, the system shall allow the schedule to reset daily counter.'
    );
    expect(
      earsOfRule(open, {
        name: 'Credit points',
        triggeredByEvent: 'order.paid'
      })
    ).toBe('When the order event "paid" occurs, the system shall allow "credit points".');
  });
});

describe('EARS sentences read like a person wrote them', () => {
  const refuse = (reason: string) => ({ type: 'block_action', reason });

  it('reads an action name in lower case, keeping acronyms and the proper names of the texts', () => {
    const properNames = properNamesIn(["Buy the island map at Travelers' Corner."]);
    expect(actionPhrase('Begin Travel')).toBe('begin travel');
    expect(actionPhrase('Buy Handheld GPS')).toBe('buy handheld GPS');
    expect(actionPhrase("Reach Travelers' Corner", properNames)).toBe("reach Travelers' Corner");
    // A word some text capitalises but another writes in lower case is a common word.
    const skills = properNamesIn(['Your Level is shown.', 'A skill never passes level 10.']);
    expect(actionPhrase('Apply Guitar Level', skills)).toBe('apply guitar level');
    // A name written as one identifier reads as the words it joins.
    expect(actionPhrase('searchRooms')).toBe('search rooms');
    expect(actionPhrase('book_room')).toBe('book room');
    expect(actionPhrase('exportPDF')).toBe('export PDF');
    expect(actionPhrase('GPSStatusCheck')).toBe('GPS status check');
    // A run of capitalised words is a name as a whole, whatever its words do elsewhere.
    const town = properNamesIn([
      'Meet at the Town Hall.',
      'The town is quiet.',
      'Ask at Ines’ Workshop.'
    ]);
    expect(actionPhrase('Reach Town Hall Door', town)).toBe('reach Town Hall door');
    expect(actionPhrase("Walk Up To Ines' Workshop", town)).toBe("walk up to Ines' Workshop");
  });

  it("does not take the feature's own action names, quoted in its texts, for proper names", () => {
    const statements = featureStatements({
      surfaces: [
        {
          name: 'Skills',
          actions: [
            {
              id: 'a1',
              name: 'Reach New Whole Level',
              rules: [
                {
                  id: 'r1',
                  effect: { type: 'allow_action' },
                  description: 'Runs after Reach New Whole Level.'
                }
              ]
            }
          ]
        }
      ]
    });
    expect(statements['rule:r1']).toBe(
      'When the user asks to reach new whole level, the system shall allow the user to reach new whole level.'
    );
  });

  it('reads an action named like an event as a clause, refused or allowed as it', () => {
    const rule = {
      condition: { left: 'internet.connected', operator: 'is_true' },
      effect: refuse('Already paid for.')
    };
    expect(earsOfRule(rule, { name: 'Internet Session Starts' })).toBe(
      'When internet session starts, if the internet connected is true, then the system shall refuse it and show "Already paid for."'
    );
    expect(
      earsOfRule({ effect: { type: 'allow_action' } }, { name: 'Reduced Motion Turned On' })
    ).toBe('When reduced motion is turned on, the system shall allow it.');
    expect(eventClause('record wages earned')).toBeNull();
  });

  it('groups an or inside an and, placed last so it swallows nothing', () => {
    const rule = {
      condition: {
        kind: 'all',
        conditions: [
          {
            kind: 'any',
            conditions: [
              { left: 'map.zoomStep', operator: 'lower_than', right: 4 },
              {
                left: 'map.placeKnowledge',
                operator: 'equals',
                right: 'unknown'
              }
            ]
          },
          { left: 'map.placeMarker', operator: 'equals', right: 'hidden' }
        ]
      },
      effect: refuse('Hidden.')
    };
    expect(earsOfRule(rule, { name: 'Show Place' })).toBe(
      'When the user asks to show place, if the map place marker is "hidden" and either the map zoom step is less than 4 or the map place knowledge is "unknown", then the system shall refuse to show place and show "Hidden."'
    );
  });

  it('reads an or of and-groups as numbered alternatives', () => {
    const waterfall = {
      condition: {
        kind: 'any',
        conditions: [
          {
            kind: 'all',
            conditions: [
              { left: 'river.reach', operator: 'equals', right: 'waterfall' },
              { left: 'waterfall.height', operator: 'greater_than', right: 0 }
            ]
          },
          {
            kind: 'all',
            conditions: [
              {
                left: 'river.reach',
                operator: 'not_equals',
                right: 'waterfall'
              },
              { left: 'waterfall.height', operator: 'equals', right: 0 }
            ]
          }
        ]
      }
    };
    expect(earsOfInvariant(waterfall)).toBe(
      'The system shall always ensure that one of these holds: (1) the river reach is "waterfall" and the waterfall height is greater than 0; (2) the river reach is not "waterfall" and the waterfall height is 0.'
    );
  });

  it('reads implications inside an and as a numbered list of only if', () => {
    const implies = (a: string, b: string) => ({
      kind: 'any',
      conditions: [
        { left: a, operator: 'is_false' },
        { left: b, operator: 'is_true' }
      ]
    });
    expect(
      earsOfInvariant({
        condition: {
          kind: 'all',
          conditions: [
            implies('hud.coordinatesShown', 'player.hasGps'),
            implies('map.coordinatesShown', 'map.open')
          ]
        }
      })
    ).toBe(
      'The system shall always ensure that all of these hold: (1) the hud coordinates shown is true only if the player has gps is true; (2) the map coordinates shown is true only if the map open is true.'
    );
  });

  it('reads an or as While its first alternative fails, collapsing the values of one subject', () => {
    const bridge = {
      condition: {
        kind: 'any',
        conditions: [
          { left: 'bridge.style', operator: 'equals', right: 'none' },
          { left: 'crossing.water', operator: 'equals', right: 'river' },
          { left: 'crossing.water', operator: 'equals', right: 'lake' },
          { left: 'crossing.water', operator: 'equals', right: 'sea' }
        ]
      }
    };
    expect(earsOfInvariant(bridge)).toBe(
      'While the bridge style is not "none", the system shall ensure that the crossing water is "river", "lake" or "sea".'
    );
    const raided = {
      condition: {
        kind: 'any',
        conditions: [
          {
            kind: 'all',
            conditions: [
              { left: 'case.status', operator: 'not_equals', right: 'raided' },
              {
                left: 'case.status',
                operator: 'not_equals',
                right: 'dismantled'
              }
            ]
          },
          { left: 'case.evidence', operator: 'greater_or_equal', right: 3 }
        ]
      }
    };
    expect(earsOfInvariant(raided)).toBe(
      'While the case status is "raided" or "dismantled", the system shall ensure that the case evidence is at least 3.'
    );
  });

  it('shows every case of a value chosen case by case, and brackets a nested computation', () => {
    const price = {
      kind: 'switch',
      cases: [
        {
          when: {
            left: { kind: 'param', name: 'item' },
            operator: 'equals',
            right: 'fins'
          },
          then: { kind: 'literal', value: 20 }
        },
        {
          when: {
            left: { kind: 'param', name: 'item' },
            operator: 'equals',
            right: 'scuba'
          },
          then: { kind: 'literal', value: 150 }
        }
      ],
      default: { kind: 'literal', value: 0 }
    };
    expect(expressionText(price)).toBe(
      '(20 if the item given is "fins"; 150 if the item given is "scuba"; otherwise 0)'
    );
    expect(
      expressionText({
        kind: 'mul',
        left: {
          kind: 'sub',
          left: { kind: 'literal', value: 100 },
          right: { kind: 'state', path: 'swim.energy' }
        },
        right: { kind: 'state', path: 'player.condition' }
      })
    ).toBe('(100 minus the swim energy) times the player condition');
  });
});

describe('an action refused under several conditions', () => {
  it('reads one lead for all of its refusals, an event-named action refused as it', () => {
    expect(refusalLead({ name: 'Dive Down' })).toBe(
      'When the user asks to dive down, the system shall refuse to dive down if any of these holds:'
    );
    expect(refusalLead({ name: 'Internet Session Starts' })).toBe(
      'When internet session starts, the system shall refuse it if any of these holds:'
    );
  });

  it('lists the states a condition reads, on both sides and once each', () => {
    expect(
      statesRead({
        kind: 'all',
        conditions: [
          {
            left: 'swim.energy',
            operator: 'greater_or_equal',
            right: { kind: 'state', path: 'rest.ceiling' }
          },
          { left: 'swim.energy', operator: 'greater_than', right: 0 },
          {
            left: { kind: 'param', name: 'item' },
            operator: 'equals',
            right: 'scuba'
          }
        ]
      })
    ).toEqual(['swim.energy', 'rest.ceiling']);
  });
});

describe('EARS sentences of statements and goals', () => {
  it('reads an always-true statement as ubiquitous', () => {
    expect(
      earsOfInvariant({
        condition: {
          left: 'wallet.balance',
          operator: 'greater_or_equal',
          right: 0
        }
      })
    ).toBe('The system shall always ensure that the wallet balance is at least 0.');
  });

  it('reads an implication as state-driven', () => {
    const goldFloor = {
      condition: {
        kind: 'any',
        conditions: [
          { left: 'loyalty.tier', operator: 'not_equals', right: 'gold' },
          {
            left: 'loyalty.points',
            operator: 'greater_or_equal',
            right: { kind: 'const', name: 'GOLD_FLOOR' }
          }
        ]
      }
    };
    expect(earsOfInvariant(goldFloor, { GOLD_FLOOR: 500 })).toBe(
      'While the loyalty tier is "gold", the system shall ensure that the loyalty points is at least GOLD_FLOOR (500).'
    );
  });

  it('reads a goal, and an always-reachable one', () => {
    const condition = {
      left: 'order.status',
      operator: 'equals',
      right: 'paid'
    };
    expect(earsOfGoal({ kind: 'reachable', condition })).toBe(
      'The system shall allow a state where the order status is "paid" to be reached.'
    );
    expect(earsOfGoal({ kind: 'always_reachable', condition })).toBe(
      'The system shall keep a state where the order status is "paid" reachable from every state.'
    );
  });
});

describe('Given/When/Then of scenarios', () => {
  it('reads the state set, the steps played, the inputs and what is expected', () => {
    const scenario = {
      stateOverrides: [{ path: 'wallet.balance', value: 200 }],
      steps: [
        {
          actionId: 'a-top',
          parameterOverrides: [{ parameterName: 'amount', value: 50 }]
        }
      ],
      parameterOverrides: [{ parameterName: 'amount', value: 100 }],
      expectedStatus: 'success',
      expectedAssertions: [{ path: 'wallet.balance', operator: 'equals', value: 150 }]
    };
    expect(gwtOfScenario(scenario, withdraw, { 'a-top': 'Top up' })).toBe(
      'Given the wallet balance is 200\nWhen the user asks to top up with amount 50, then to withdraw with amount 100\nThen it succeeds and the wallet balance is 150'
    );
  });

  it('reads a refusal from the starting state', () => {
    expect(gwtOfScenario({ expectedStatus: 'blocked' }, { name: 'Freeze account' })).toBe(
      'Given the starting state\nWhen the user asks to freeze account\nThen it is refused'
    );
  });
});

describe('featureStatements', () => {
  it('keys every sentence of a feature by kind and id', () => {
    const statements = featureStatements({
      constants: [{ name: 'CAP', value: 3 }],
      featureInvariants: [
        {
          id: 'i1',
          condition: {
            left: 'x',
            operator: 'lower_or_equal',
            right: { kind: 'const', name: 'CAP' }
          }
        }
      ],
      reachabilityGoals: [
        {
          id: 'g1',
          kind: 'reachable',
          condition: { left: 'x', operator: 'equals', right: 3 }
        }
      ],
      surfaces: [
        {
          name: 'Counter',
          rules: [{ id: 'sr1', effect: { type: 'allow_action' } }],
          invariants: [],
          actions: [
            {
              id: 'a1',
              name: 'Add',
              rules: [
                {
                  id: 'r1',
                  condition: {
                    left: 'x',
                    operator: 'greater_or_equal',
                    right: 3
                  },
                  effect: { type: 'block_action' }
                }
              ],
              invariants: [],
              scenarios: [{ id: 's1', expectedStatus: 'success' }]
            }
          ]
        }
      ]
    });
    expect(Object.keys(statements).sort()).toEqual([
      'goal:g1',
      'invariant:i1',
      'rule:r1',
      'rule:sr1',
      'scenario:s1'
    ]);
    expect(statements['invariant:i1']).toBe(
      'The system shall always ensure that the x is at most CAP (3).'
    );
    expect(statements['rule:sr1']).toBe(
      'When the user asks to act on the Counter screen, the system shall allow the user to act there.'
    );
  });

  it('never throws on an unknown shape', () => {
    expect(featureStatements(null)).toEqual({});
    expect(featureStatements({ surfaces: [{ actions: [{ rules: [{}] }] }] })).toEqual({
      'rule:': 'When the user asks to , the system shall act.'
    });
  });
});

/** A French expectation with the spaces French typography keeps unbreakable: inside « » and before : ; ! ? */
const nb = (text: string): string =>
  text
    .replace(/« /g, '«\u00a0')
    .replace(/ »/g, '\u00a0»')
    .replace(/ ([:;!?])/g, '\u00a0$1');

describe('sentences in French, the names of the model quoted as written', () => {
  it('reads a guard on the state and one on an input in one si ... alors, state first', () => {
    const rule = {
      condition: {
        kind: 'all',
        conditions: [
          { left: 'air.supply', operator: 'greater_than', right: 0 },
          {
            left: { kind: 'param', name: 'depth' },
            operator: 'greater_than',
            right: { kind: 'const', name: 'MAX_DEPTH' }
          }
        ]
      },
      effect: { type: 'block_action' }
    };
    expect(earsOfRule(rule, { name: 'Dive Down' }, { MAX_DEPTH: 40 }, 'fr')).toBe(
      nb(
        "Lorsque l'utilisateur déclenche l'action « Dive Down », si « air.supply » est supérieur à 0 et le paramètre « depth » est supérieur à « MAX_DEPTH » (40), alors le système doit la refuser."
      )
    );
  });

  it('quotes the message a refusal shows, and contracts "à le" into "au"', () => {
    const rule = {
      condition: {
        left: 'wallet.balance',
        operator: 'lower_than',
        right: { kind: 'param', name: 'amount' }
      },
      effect: { type: 'block_action', reason: 'Solde insuffisant.' }
    };
    expect(earsOfRule(rule, withdraw, {}, 'fr')).toBe(
      nb(
        "Lorsque l'utilisateur déclenche l'action « Withdraw », si « wallet.balance » est inférieur au paramètre « amount », alors le système doit la refuser et afficher « Solde insuffisant. »"
      )
    );
  });

  it('reads an event-triggered action, an action named like an event and a schedule', () => {
    const open = { effect: { type: 'allow_action' } };
    expect(
      earsOfRule(open, { name: 'Credit points', triggeredByEvent: 'order.paid' }, {}, 'fr')
    ).toBe(
      nb(
        "Lorsque l'événement « Order Paid » se produit, le système doit autoriser l'action « Credit points »."
      )
    );
    expect(
      earsOfRule(
        {
          condition: { left: 'internet.connected', operator: 'is_true' },
          effect: { type: 'block_action', reason: 'Déjà payé.' }
        },
        { name: 'Internet Session Starts' },
        {},
        'fr'
      )
    ).toBe(
      nb(
        "Lorsque « Internet Session Starts » se produit, si « internet.connected » est vrai, alors le système doit refuser l'action « Internet Session Starts » et afficher « Déjà payé. »"
      )
    );
    expect(earsOfRule(open, { name: 'Reset Daily Counter', actor: 'schedule' }, {}, 'fr')).toBe(
      nb(
        "Lorsque le planificateur déclenche l'action « Reset Daily Counter », le système doit permettre au planificateur de la déclencher."
      )
    );
    expect(earsOfRule(open, { name: 'Sync', actor: 'event' }, {}, 'fr')).toBe(
      nb(
        "Lorsqu'un événement déclenche l'action « Sync », le système doit permettre à un événement de la déclencher."
      )
    );
  });

  it('groups a nested or as soit ..., soit, and reads a numbered list', () => {
    const rule = {
      condition: {
        kind: 'all',
        conditions: [
          {
            kind: 'any',
            conditions: [
              { left: 'map.zoomStep', operator: 'lower_than', right: 4 },
              {
                left: 'map.placeKnowledge',
                operator: 'equals',
                right: 'unknown'
              }
            ]
          },
          { left: 'map.placeMarker', operator: 'equals', right: 'hidden' }
        ]
      },
      effect: { type: 'show_message', message: 'Lieu caché' }
    };
    expect(earsOfRule(rule, { name: 'Show Place' }, {}, 'fr')).toBe(
      nb(
        "Lorsque l'utilisateur déclenche l'action « Show Place », si « map.placeMarker » vaut « hidden » et soit « map.zoomStep » est inférieur à 4, soit « map.placeKnowledge » vaut « unknown », alors le système doit afficher « Lieu caché »."
      )
    );
    expect(
      conditionText(
        {
          kind: 'any',
          conditions: [
            {
              kind: 'all',
              conditions: [
                { left: 'river.reach', operator: 'equals', right: 'waterfall' },
                {
                  left: 'waterfall.height',
                  operator: 'greater_than',
                  right: 0
                }
              ]
            },
            {
              kind: 'not',
              condition: { left: 'river.reach', operator: 'exists' }
            }
          ]
        },
        {},
        0,
        'fr'
      )
    ).toBe(
      nb(
        "l'une de ces conditions est réunie : (1) « river.reach » vaut « waterfall » et « waterfall.height » est supérieur à 0 ; (2) il n'est pas vrai que « river.reach » est renseigné"
      )
    );
  });

  it('reads a value chosen case by case, eliding "si il"', () => {
    const price = {
      kind: 'switch',
      cases: [
        {
          when: {
            left: { kind: 'param', name: 'item' },
            operator: 'equals',
            right: 'fins'
          },
          then: { kind: 'literal', value: 20 }
        },
        {
          when: {
            kind: 'not',
            condition: { left: 'shop.open', operator: 'is_true' }
          },
          then: { kind: 'literal', value: 150 }
        }
      ],
      default: { kind: 'literal', value: 0 }
    };
    expect(expressionText(price, {}, 'fr')).toBe(
      nb(
        "(20 si le paramètre « item » vaut « fins » ; 150 s'il n'est pas vrai que « shop.open » est vrai ; sinon 0)"
      )
    );
    expect(
      expressionText(
        {
          kind: 'mul',
          left: {
            kind: 'sub',
            left: { kind: 'literal', value: 100 },
            right: { kind: 'state', path: 'swim.energy' }
          },
          right: {
            kind: 'count',
            operand: { kind: 'state', path: 'bag.items' }
          }
        },
        {},
        'fr'
      )
    ).toBe(nb("(100 moins « swim.energy ») fois le nombre d'éléments de « bag.items »"));
  });

  it('reads an invariant with an implication, one that is an or, and a numbered only if', () => {
    const goldFloor = {
      condition: {
        kind: 'any',
        conditions: [
          { left: 'loyalty.tier', operator: 'not_equals', right: 'gold' },
          {
            left: 'loyalty.points',
            operator: 'greater_or_equal',
            right: { kind: 'const', name: 'GOLD_FLOOR' }
          }
        ]
      }
    };
    expect(earsOfInvariant(goldFloor, { GOLD_FLOOR: 500 }, 'fr')).toBe(
      nb(
        'Tant que « loyalty.tier » vaut « gold », le système doit garantir que « loyalty.points » est au moins « GOLD_FLOOR » (500).'
      )
    );
    const bridge = {
      condition: {
        kind: 'any',
        conditions: [
          { left: 'bridge.style', operator: 'equals', right: 'none' },
          { left: 'crossing.water', operator: 'equals', right: 'river' },
          { left: 'crossing.water', operator: 'equals', right: 'lake' },
          { left: 'crossing.water', operator: 'equals', right: 'sea' }
        ]
      }
    };
    expect(earsOfInvariant(bridge, {}, 'fr')).toBe(
      nb(
        'Tant que « bridge.style » ne vaut pas « none », le système doit garantir que « crossing.water » vaut « river », « lake » ou « sea ».'
      )
    );
    const implies = (a: string, b: string) => ({
      kind: 'any',
      conditions: [
        { left: a, operator: 'is_false' },
        { left: b, operator: 'is_true' }
      ]
    });
    expect(
      earsOfInvariant(
        {
          condition: {
            kind: 'all',
            conditions: [
              implies('hud.coordinatesShown', 'player.hasGps'),
              implies('map.coordinatesShown', 'map.open')
            ]
          }
        },
        {},
        'fr'
      )
    ).toBe(
      nb(
        'Le système doit toujours garantir que toutes ces conditions sont réunies : (1) « hud.coordinatesShown » est vrai seulement si « player.hasGps » est vrai ; (2) « map.coordinatesShown » est vrai seulement si « map.open » est vrai.'
      )
    );
    expect(
      earsOfInvariant({ condition: { kind: 'all_match', overPath: 'cart.items' } }, {}, 'fr')
    ).toBe(
      nb('Le système doit toujours garantir que chaque élément de « cart.items » correspond.')
    );
    expect(
      earsOfInvariant(
        {
          condition: {
            left: 'wallet.balance',
            operator: 'greater_or_equal',
            right: 0
          }
        },
        {},
        'fr'
      )
    ).toBe(nb('Le système doit toujours garantir que « wallet.balance » est au moins 0.'));
  });

  it('reads a goal, and an always-reachable one', () => {
    const condition = {
      left: 'order.status',
      operator: 'equals',
      right: 'paid'
    };
    expect(earsOfGoal({ kind: 'reachable', condition }, {}, 'fr')).toBe(
      nb("Le système doit permettre d'atteindre un état où « order.status » vaut « paid ».")
    );
    expect(earsOfGoal({ kind: 'always_reachable', condition }, {}, 'fr')).toBe(
      nb(
        'Le système doit garder atteignable, depuis tout état, un état où « order.status » vaut « paid ».'
      )
    );
  });

  it('reads a scenario as Étant donné / Quand / Alors', () => {
    const scenario = {
      stateOverrides: [
        { path: 'wallet.balance', value: 200 },
        { path: 'wallet.status', value: 'open' }
      ],
      steps: [
        {
          actionId: 'a-top',
          parameterOverrides: [{ parameterName: 'amount', value: 50 }]
        }
      ],
      parameterOverrides: [{ parameterName: 'amount', value: 100 }],
      expectedStatus: 'success',
      expectedAssertions: [
        { path: 'wallet.balance', operator: 'equals', value: 150 },
        { path: 'wallet.lastError', operator: 'does_not_exist' }
      ]
    };
    expect(gwtOfScenario(scenario, withdraw, { 'a-top': 'Top up' }, 'fr')).toBe(
      nb(
        "Étant donné que « wallet.balance » vaut 200 et « wallet.status » vaut « open »\nQuand l'utilisateur déclenche l'action « Top up » avec « amount » à 50, puis l'action « Withdraw » avec « amount » à 100\nAlors l'action réussit, « wallet.balance » vaut 150 et « wallet.lastError » n'est pas renseigné"
      )
    );
    expect(gwtOfScenario({ expectedStatus: 'blocked' }, { name: 'Freeze account' }, {}, 'fr')).toBe(
      nb(
        "Étant donné l'état initial\nQuand l'utilisateur déclenche l'action « Freeze account »\nAlors l'action est refusée"
      )
    );
  });

  it('reads the refusal lead of an action and every sentence of a feature', () => {
    expect(refusalLead({ name: 'Dive Down' }, 'fr')).toBe(
      nb(
        "Lorsque l'utilisateur déclenche l'action « Dive Down », le système doit la refuser si l'une de ces conditions est réunie :"
      )
    );
    expect(
      refusalCase(
        {
          condition: {
            left: 'air.supply',
            operator: 'lower_or_equal',
            right: 0
          }
        },
        {},
        'fr'
      )
    ).toBe(nb('« air.supply » est au plus 0'));
    const statements = featureStatements(
      {
        constants: [{ name: 'CAP', value: 3 }],
        featureInvariants: [
          {
            id: 'i1',
            condition: {
              left: 'x',
              operator: 'lower_or_equal',
              right: { kind: 'const', name: 'CAP' }
            }
          }
        ],
        reachabilityGoals: [
          {
            id: 'g1',
            kind: 'reachable',
            condition: { left: 'x', operator: 'equals', right: 3 }
          }
        ],
        surfaces: [
          {
            name: 'Counter',
            rules: [
              { id: 'sr1', effect: { type: 'allow_action' } },
              { id: 'sr2', effect: { type: 'block_action', reason: 'Fermé' } }
            ],
            actions: [
              {
                id: 'a1',
                name: 'Add',
                rules: [
                  {
                    id: 'r1',
                    condition: {
                      left: 'x',
                      operator: 'greater_or_equal',
                      right: 3
                    },
                    effect: {
                      type: 'set_state',
                      path: 'x',
                      value: { kind: 'literal', value: 0 }
                    }
                  }
                ],
                scenarios: [{ id: 's1', expectedStatus: 'success' }]
              }
            ]
          }
        ]
      },
      'fr'
    );
    expect(statements).toEqual({
      'invariant:i1': nb('Le système doit toujours garantir que « x » est au plus « CAP » (3).'),
      'goal:g1': nb("Le système doit permettre d'atteindre un état où « x » vaut 3."),
      'rule:sr1': nb(
        "Lorsque l'utilisateur agit sur l'écran « Counter », le système doit l'y autoriser."
      ),
      'rule:sr2': nb(
        "Lorsque l'utilisateur agit sur l'écran « Counter », le système doit l'en empêcher et afficher « Fermé »."
      ),
      'rule:r1': nb(
        "Lorsque l'utilisateur déclenche l'action « Add », si « x » est au moins 3, alors le système doit mettre « x » à 0."
      ),
      'scenario:s1': nb(
        "Étant donné l'état initial\nQuand l'utilisateur déclenche l'action « Add »\nAlors l'action réussit"
      )
    });
  });

  it('never reads a missing value as "rien"', () => {
    const leaf = (operator: string, right: unknown) =>
      conditionText({ left: 'order.coupon', operator, right }, {}, 0, 'fr');
    expect(leaf('equals', null)).toBe(nb("« order.coupon » n'est pas renseigné"));
    expect(leaf('not_equals', null)).toBe(nb('« order.coupon » est renseigné'));
    expect(leaf('equals', { kind: 'literal', value: null })).toBe(
      nb("« order.coupon » n'est pas renseigné")
    );
    expect(
      earsOfRule(
        {
          effect: {
            type: 'set_state',
            path: 'order.coupon',
            value: { kind: 'literal', value: null }
          }
        },
        { name: 'Clear Coupon' },
        {},
        'fr'
      )
    ).toBe(
      nb(
        "Lorsque l'utilisateur déclenche l'action « Clear Coupon », le système doit vider « order.coupon »."
      )
    );
    expect(
      gwtOfScenario(
        {
          stateOverrides: [{ path: 'order.coupon', value: null }],
          parameterOverrides: [{ parameterName: 'code', value: null }],
          expectedAssertions: [{ path: 'order.coupon', operator: 'not_equals', value: null }]
        },
        { name: 'Apply' },
        {},
        'fr'
      )
    ).toBe(
      nb(
        "Étant donné que « order.coupon » n'est pas renseigné\nQuand l'utilisateur déclenche l'action « Apply » avec « code » non renseigné\nAlors l'action réussit et « order.coupon » est renseigné"
      )
    );
    // Anywhere else, a missing value is named as such.
    expect(expressionText({ kind: 'literal', value: null }, {}, 'fr')).toBe('aucune valeur');
    // English keeps its wording.
    expect(conditionText({ left: 'order.coupon', operator: 'equals', right: null })).toBe(
      'the order coupon is nothing'
    );
  });

  it('reads an empty text, a truth value and a decimal number the French way', () => {
    const leaf = (operator: string, right: unknown) =>
      conditionText({ left: 'profile.nickname', operator, right }, {}, 0, 'fr');
    expect(leaf('equals', '')).toBe(nb('« profile.nickname » vaut un texte vide'));
    expect(leaf('equals', true)).toBe(nb('« profile.nickname » est vrai'));
    expect(leaf('equals', { kind: 'literal', value: false })).toBe(
      nb('« profile.nickname » est faux')
    );
    expect(leaf('not_equals', true)).toBe(nb("« profile.nickname » n'est pas vrai"));
    expect(leaf('greater_than', 3.5)).toBe(nb('« profile.nickname » est supérieur à 3,5'));
    expect(
      conditionText(
        {
          kind: 'any',
          conditions: [
            { left: 'x', operator: 'equals', right: 'a' },
            { left: 'x', operator: 'equals', right: null }
          ]
        },
        {},
        0,
        'fr'
      )
    ).toBe(nb("« x » vaut « a » ou « x » n'est pas renseigné"));
    expect(conditionText({ left: 'x', operator: 'greater_than', right: 3.5 })).toBe(
      'the x is greater than 3.5'
    );
  });

  it('keeps the space before a colon and inside the quotes unbreakable', () => {
    const lead = refusalLead({ name: 'Dive Down' }, 'fr');
    expect(lead).toContain('\u00a0Dive Down\u00a0');
    expect(lead.endsWith('réunie\u00a0:')).toBe(true);
  });
});

describe('the sentences of the editor', () => {
  const ship = { name: 'Ship Order' };

  it('reads an effect as what the system shall do when the action goes through', () => {
    const effect = { type: 'set_state', path: 'order.status', value: 'shipped' };
    expect(earsOfEffect(effect, ship)).toBe(
      'When the user asks to ship order, the system shall set the order status to "shipped".'
    );
    expect(earsOfEffect(effect, ship, {}, 'fr').replace(/\u00a0/g, ' ')).toBe(
      "Lorsque l'utilisateur déclenche l'action « Ship Order », le système doit mettre « order.status » à « shipped »."
    );
  });

  it('reads a computed effect with the value of its constant', () => {
    const effect = {
      type: 'set_state',
      path: 'storage.source',
      value: {
        kind: 'sub',
        left: { kind: 'state', path: 'storage.source' },
        right: { kind: 'const', name: 'BATCH' }
      }
    };
    expect(earsOfEffect(effect, { name: 'Move Stock' }, { BATCH: 5 })).toBe(
      'When the user asks to move stock, the system shall set the storage source to the storage source minus BATCH (5).'
    );
  });

  it('reads the language from the feature’s own texts, English when they say nothing', () => {
    const french = {
      description:
        "Le stock est déplacé d'un entrepôt à un autre et la destination doit être assez grande.",
      surfaces: [
        {
          actions: [
            { rules: [{ effect: { reason: 'La destination est trop petite pour le lot.' } }] }
          ]
        }
      ]
    };
    expect(featureLanguage(french)).toBe('fr');
    expect(featureLanguage({})).toBe('en');
  });

  it('reads the constants and who asks for an action', () => {
    expect(featureConstants({ constants: [{ name: 'MAX', value: 3 }] })).toEqual({ MAX: 3 });
    expect(actionContextOf({ name: 'Tick', actor: 'schedule' })).toMatchObject({
      name: 'Tick',
      actor: 'schedule'
    });
  });
});

describe('a name written as a code identifier reads in words [criterion:ac-leaf-ac-tree-readable-actions]', () => {
  it('splits snake, kebab, camel, Pascal and dotted identifiers into capitalised words', () => {
    expect(readableName('await_risk_inputs')).toBe('Await Risk Inputs');
    expect(readableName('select-room')).toBe('Select Room');
    expect(readableName('searchRooms')).toBe('Search Rooms');
    expect(readableName('RiskAnalysis')).toBe('Risk Analysis');
    expect(readableName('collection.completed')).toBe('Collection Completed');
    expect(readableName('fetchHTTPStatus')).toBe('Fetch HTTP Status');
  });

  it('leaves a name already written in words as its author wrote it', () => {
    expect(readableName('Credit points')).toBe('Credit points');
    expect(readableName('Withdraw')).toBe('Withdraw');
    expect(readableName('')).toBe('');
  });

  it('quotes actions, screens and events in words in a French sentence', () => {
    const open = { effect: { type: 'allow_action' } };
    expect(
      earsOfRule(
        open,
        { name: 'await_risk_inputs', actor: 'event', triggeredByEvent: 'collection.completed' },
        {},
        'fr'
      )
    ).toBe(
      nb(
        "Lorsque l'événement « Collection Completed » se produit, le système doit autoriser l'action « Await Risk Inputs »."
      )
    );
    expect(
      earsOfRule({ effect: { type: 'block_action' } }, { surfaceName: 'RiskAnalysis' }, {}, 'fr')
    ).toBe(
      nb("Lorsque l'utilisateur agit sur l'écran « Risk Analysis », le système doit l'en empêcher.")
    );
  });

  it('reads a screen named as an identifier in words in an English sentence', () => {
    expect(earsOfRule({ effect: { type: 'block_action' } }, { surfaceName: 'RiskAnalysis' })).toBe(
      'When the user asks to act on the Risk Analysis screen, the system shall refuse to act there.'
    );
  });
});
