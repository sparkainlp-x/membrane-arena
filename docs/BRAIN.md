# Brain architecture: many membranes, joined by microtubules

This is a layered build of the arena's membranes: many membranes of several kinds, joined by links called microtubules, with the number of each kind set by a vote-counting rule. It is a SYNTHETIC classical simulation. It does not model real neurons, real microtubules, a brain or any physical device, and nothing here was run on or measured on hardware.

Open `dist/brain.html` in a browser (offline, one file), or run `node scripts/brain.js` in a terminal.

## The short version

To tolerate f faulty voters, a layer needs **2f + 1** of them and releases only when a **strict majority** (f + 1) agree. With fewer voters, either the faulty ones can release on their own or the honest ones cannot release at all. With an even number, the layer tolerates no more faults than with one voter fewer. `tests/brain.test.js` checks this by trying every placement of faults, and table A of [brain-check.txt](brain-check.txt) prints it.

Within that bound the simulated brain released **no false output in any measured run** (0 of 1,000 episodes in each of the colluding, stuck and silent scenarios). Past the bound, colluding faults decided **every** output (1,000 of 1,000).

The cost is liveness. The number is the minimum for safety, and it leaves no spare honest voters. Recall fell from 0.99 with no faults to 0.81 with one colluding member per column, and to 0.41 with a compromised column as well. Every remaining honest member then has to declare, and the vector still has to arrive by step 60. To buy back recall, add voters above 2f + 1 or use shorter delays (table D).

## The membranes and why there are this many

| Kind | Count | Rule |
|---|---|---|
| sensory | C x (2f + 1) | learns the hidden pattern with the arena's Oja rule; tolerates f faulty members per column |
| gate | C = 2g + 1 | one per column; releases when f + 1 of its column agree; tolerates g compromised columns |
| integrator | 2h + 1 | each releases when g + 1 columns agree; tolerates h faulty integrators |
| output | 1 | releases the final event when h + 1 integrators agree; assumed fault-free |
| inhibitory | 0 or 1 | the arena's stabilizer: follows the output rate and scales every sensory gain |
| memory | 0 or 1 | the arena's amplifier: the next episode starts partly (weight 0.5) from the last output |

With the defaults (f = 1, g = 1, h = 0, stabilizer on) that is **15 membranes and 17 microtubules**: 9 sensory, 3 gates, 1 integrator, 1 output, 1 inhibitory. Table F shows how this grows, for example 35 membranes and 49 microtubules for f = 2, g = 2, h = 1.

## What a microtubule is here

A microtubule is a directed link that carries a released vector to the next membrane. It has a delay, counted in check periods of 10 steps, and optional transport noise. Signal microtubules run sensory to gate, gate to integrator, and integrator to output. Modulatory ones carry the inhibitory and memory influence. Anything that would arrive after step 60 is lost. The checker rejects loops, links to missing membranes, cut paths and delays too long for any output to arrive.

## Findings from the measurement run

All of these come from [brain-check.txt](brain-check.txt): 5 seeds x 200 episodes, half with a planted pattern.

- **Redundancy improved quality, not just safety.** With no faults the brain's output matched the pattern better (mean |<v|pattern>| 0.968) than one sensory membrane alone (0.874). Its recall was 0.990 against 0.936, with 0 false outputs against 3.
- **Coupling is a hidden fault channel.** With coupling 0.05 inside a column, a single colluding member per column (within the bound) dragged its honest peers toward its vector: 313 false outputs in 1,000 episodes. At coupling 0 there were none. Coupling therefore defaults to 0 in the brain (the arena starts at 0.05), and the checker flags any coupling above 0 as an error when faults must be tolerated.
- **Delay costs recall.** With no faults, recall was 1.000 with a gate-to-integrator delay of 0, 0.990 with 1, 0.858 with 2, 0.378 with 3 and 0.004 with 4. The default delay is 1.
- **Fusing agreeing vectors helped.** Averaging the agreeing vectors (after aligning their phase) raised output fidelity from 0.864 to 0.968 compared with passing on the first one.

## Assumptions (design choices, not findings)

- The layout itself: columns, gates, integrators, one output.
- Faulty units take the lowest indices; the tests also try every placement at the logic level.
- The output, inhibitory and memory membranes are assumed fault-free. The checker lists them as single points of failure.
- Two vectors agree when their fidelity is at least the arena's AGREE value. Each layer releases at most one vector per episode, the earliest and lowest-numbered (the same rule as the arena's 2-of-3 shield, which a test confirms).
- Fault behaviours: collude (all faulty units send the same wrong vector), stuck (each sends its own random vector) and silent (sends nothing). A faulty member that declares early stops drawing observations, so the honest members' random draws differ between modes. That is why the silent row differs slightly from the stuck and collude rows.
- The parameters were hand-picked, the data are synthetic, and the confidence intervals treat episodes as independent (the stabilizer links them, so they are approximate).

## Algorithms, interfaces and hardware, assessed separately

- **Algorithm:** the counting rule is proved by exhaustive enumeration for columns of 1 to 7, for 3 x 3 columns with gates (4,096 cases) and for 3 integrators. The learning reuses `game.js`: one column of three honest membranes reproduces `game.js` `episode()` draw for draw. The simulated rates are measurements of this software only.
- **Interfaces:** `brain.js` is a UMD module (Node and browser) with `planArchitecture`, `checkArchitecture`, `runBrain` (or the step-wise `createBrainRun` / `stepBrainRun`), `logicOutcome`, `renderSvg` and `toJSON`. Inputs are sanitized and clipped to limits.
- **Hardware readiness:** none claimed. The timings are single-thread JavaScript on one machine: 7.3 s of wall time for 1,000 episodes (453,440 Oja updates) in Node 24.

## Run it

```
node scripts/brain.js                               # plan, check and run the defaults
node scripts/brain.js --f 2 --g 1 --h 1 --mem       # bigger plan with a memory membrane
node scripts/brain.js --fault-sensory 1 --fault-columns 1 --mode collude
node scripts/brain.js --c 0.05                      # shows the coupling error
node scripts/brain.js --json > run.json             # machine-readable record
node scripts/brain.js --svg brain.svg               # the diagram
node scripts/brain-check.js                         # rewrite docs/brain-check.txt (about 2.5 minutes)
node build.js                                       # rebuild dist/index.html and dist/brain.html
node --test tests/*.test.js                         # all tests
```

The headless Chrome check (`scripts/brain-e2e-check.js`, which needs playwright-core and Chrome) writes [brain-e2e-report.json](brain-e2e-report.json) and the `docs/screenshots/brain-*.png` files.

Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
