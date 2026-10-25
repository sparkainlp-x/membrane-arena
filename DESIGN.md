# Design

Membrane Arena turns the three-membrane contest of [crystallization-contest](https://github.com/sparkainlp-x/crystallization-contest) into a game that is honest about what that contest did and did not show. This file records the decisions and their reasons.

## Fidelity to the repository

`game.js` is a port of `crystallization_contest/{events,rewards,contest}.py` at width n = 32, the smallest measured width, so the width-32 rows of the results tables apply directly.

- Vectors live in C^32 (two Float64 arrays). Observations are noisy copies of the planted pattern (complex Gaussian noise, sigma = 1.5 / sqrt(n)) or random unit vectors.
- Each membrane takes an Oja step, then a coupling step toward each peer (`c`, phase-aligned), then renormalises. Membranes that have declared stop updating. Random numbers are drawn in the same order as the Python code.
- Every 10 steps (of 60) an undeclared membrane declares when `gain * n * mean(last 5 |<x|v>|^2)` reaches `1 + q * n / (1 + 2 sigma^2 n)`, with `q = min(1.5, th * (2 - sp))` and `sp` the membrane's running confirmation rate.
- Truth: the episode is planted and fidelity to the pattern is at least 0.5. Agreement between two declarations: fidelity at least 0.4.
- Shield: the first declared membrane confirmed by at least two of three (itself included) leaves; otherwise nothing leaves.
- Amplifier: the next episode's starting vectors blend toward the last output with weight at most 0.5.
- Stabilizer: a leaky integrator of the output rate (leak 0.3, target 0.5) scales the gain by `max(0.2, 1 - 1.5 (rate - 0.5))`; the evolved gain is clamped to [0.33, 3].
- (1+1)-ES: per generation each membrane mutates `th` (log-normal, 0.2), `c` (normal, 0.05, clamped to [0, 0.5]) and `g` (log-normal, 0.2), and keeps the mutation if its score is at least its best so far. Score: `w * joint + (1 - w) * rank bonus`, as in the repository.

The generators differ (xmur3 seeding plus mulberry32 and Box-Muller here, Python's Mersenne Twister there), so runs are not bit-identical. `scripts/port-check.js` compares the port with the repository's 12 width-32 rows over 100 seeds each and writes `docs/port-check.txt`; the largest difference was 1.07 combined standard errors over 36 comparisons. That describes agreement, it is not a proof of equivalence.

## What the game adds, and says so

- **Reward schemes.** The repository's contest had no reward scheme; schemes were measured separately (Experiment 1). To make the choice playable the game adds `0.25 x` the summed per-episode scheme reward (`rewards.py`, for three agents) to each membrane's selection score. "None" is exactly the repository's contest. The UI states that this combination was not measured, and `docs/scheme-check.txt` shows what it did in this port: little.
- **Cost per false event.** The repository's `fcost` option, exposed as a slider (default 0).
- **Game score.** `50 x net + 25 x precision + 25 x steadiness`. Net counts an unshielded output as 1/3 of an episode and a shielded one as 1 so that the two modes are comparable, divided by the 48 planted episodes and clamped. Steadiness is `1 - rate variance / 0.05`, clamped; with no output at all it is 0, so staying silent earns nothing. These weights are a design choice; the results screen says part of the shield's steadiness is mechanical.
- **Seeded starting parameters.** `startFor(seed)` draws the starting threshold (0.30 to 0.80), coupling (0 to 0.30) and gain (0.70 to 1.50). A fixed daily start makes steering matter: from a poor start, evolution helps; from the repository's start it can lose (`docs/evolve-check.txt`). Starting values lock when a run begins; switching evolution off freezes them.
- **Baseline score.** The same formula applied to the repository's mean counts, labelled approximate.

## Lazy generation stepping

The player may change settings while the contest runs. `stepGeneration(contest, settings)` computes one generation (about 10 ms) with the settings in force at its start; the canvas then replays it as a timeline. Earlier generations never change, which is tested. Settings changed mid-generation apply from the next one, and the UI says so.

## Timeline and rendering

`buildTimeline` turns a generation record into events (declarations, per-episode outputs, generation end) at times set by a fixed 60 steps per second at 1x. The arena advances the clock by `dt x speed` and fires each event exactly once (tested against arbitrary frame sizes), so the animation, the counters, the ribbon and the announcements share one clock.

- Membranes: six wavy rings per membrane whose amplitude grows with the ratio of energy to threshold; colour runs from dim navy to the membrane's hue at threshold, to near white above; a progress arc shows the same ratio.
- Particles: a pooled array of at most 320 (observation flow from the source, link flow between membranes at a rate proportional to `c`).
- Bursts: a true declaration grows a hexagonal gold lattice; a false one draws grey cracks and speckle. Truth is shown only at the declaration, never before it. Shield pass flashes the triangle gold; a held declaration draws a dashed grey triangle.
- Colour is never the only signal: events differ in shape, the ribbon uses letters (T, F, H) and every outcome is announced in text.
- Reduced motion (media query, live) removes ripples and particles and shows bursts at full size, fading by opacity only.
- The device pixel ratio is capped at 2, and the draw loop clamps `dt` so a hidden tab does not leap ahead.
- Draw cost was 0.5 to 0.7 ms per frame on average in the headless pass (`docs/e2e-report.json`).

## The Lab: statistics and what they do not show

- **Rates.** Wilson 95 percent bands on cumulative true-event and false-event rates. Episodes are treated as independent trials, which they are not fully, because the parameters evolve between generations; the page says so.
- **Probe.** The histogram and the threshold sweep need what each membrane would do at every threshold, which a live episode cannot give because a declaration freezes the membrane. The probe runs K extra seeded episodes (half planted) with the contest's current parameters and nobody frozen, and records the gain-scaled energy ratio and the fidelity at the six check steps. It draws from its own seeded stream, so the contest is untouched. With coupling above zero it is an approximation of the live episode, and the Method panel says so. K is 24 while a contest runs (so a generation boundary does not stall the animation) and 60 afterwards.
- **Sweep.** A declaration at threshold x is the first check with a score of at least x; it is true when the episode is planted and the fidelity is at least 0.5 there. Recall can rise with the threshold at first because an early crossing happens before the vector has aligned; the test asserts that the number of declarations never rises.
- **Shield counts.** Each declaration is counted once: it left the shield, it was held (no 2-of-3 agreement released anything that episode), or it was redundant (another confirmed declaration of the same episode already left).
- **Ensembles.** Seeds `e1`..`eN`, one contest each, stepped in slices of about 12 ms so the page stays responsive (about 95 ms per contest in headless Chrome on one machine). Mean with a t interval and a seeded 1000-resample percentile bootstrap. The repository row is overlaid with an interval computed from its reported standard deviations, and its game score is approximate. The overlay is like for like only when the setup matches how the repository ran: scheme none, failure cost 0, evolution on, starting parameters threshold 0.5, coupling 0.05, gain 1.0 (`matchRepository`).
- **A/B tests.** Both arms use the same seed strings (common random numbers), so their random streams match until the two settings make them differ. The paired difference per seed gets a t interval and a bootstrap interval. Four metrics are shown and nothing is corrected for that: the test is exploratory. A difference of 0 inside the interval means none was detected at this sample size, not that none exists.
- **Missions.** Experiments scored by the same code that draws the tables: shield on against off (does the interval for false outputs exclude 0 and favour the shield), consensus against individual reward (which metrics lag), amplifier on against off (any detected effect), the repository match (how many of three intervals overlap the repository means), and beating the repository reference score. A mission only counts if it was run as described, and the outcome is reported as measured. Records are checked field by field on load.

## Visuals and what they encode

Each visual draws a number from the simulation record, and the Method panel lists them. Membrane ring colour and progress arc: gain times energy ratio over the threshold. Ring ripple amplitude: the same ratio. Mesh deformation: the other two membranes' energy, scaled by the coupling. Compass needle: the angle acos |<v|s>| between the weight vector and the signal (dashed when the episode has no signal). Particle rate: energy over threshold. Crystal: a true declaration, branching with a seed taken from the event counter; cracks: a false one. Shield gate: open and gold when an output leaves, shut and grey when held. Replay growth is a function of the simulation step, so scrubbing animates it. The intro is decoration, off in reduced motion, and skippable by click or Escape.

Draw cost was about 0.6 to 1.2 ms per frame on average and 1.5 to 25 ms at worst in headless Chrome; ensembles never stalled a frame for more than about 50 ms.

## Accessibility

Keyboard: Space, G, F, S (open the Lab), Escape (skip the intro), arrow keys, Home and End on the tabs, plus every control is a native element. Three levels of motion: the system setting, a page switch, and the default. High contrast is a separate switch that changes the canvas palette and the page. Every chart canvas is `role="img"` with `aria-describedby` pointing at a printed text equivalent, and the arena has a description that updates with the episode, the step and the replay position. An `aria-live` region announces each generation summary, and each episode event at 1x and 2x (faster speeds would flood a screen reader). The three gains and the output rate are `role="meter"` with value text. The canvas is `role="img"` with a text alternative, since all information is repeated as text. Buttons and inputs are at least 44 px high. Focus is visible and the help dialog traps Tab and closes on Escape.

## Data handling

- **Hash.** `parseHash` accepts `d` (a real date on or after 2026-10-24), `s` (1 to 24 of `[A-Za-z0-9_-]`), `b` (integer 0 to 100), `l` (two lowercase letters), `c` (a strict preset pattern) and nothing else. Over-long or malformed input falls back to the daily contest. A seed is data: `__proto__` is a legal seed and never used as a property name.
- **Storage.** `sanitizeStore` rebuilds the record entry by entry; wrong types, impossible dates, out-of-range scores and unknown tags are dropped. If `localStorage` throws, the game continues and says the record will not persist.
- **Share card.** Plain text, no emoji, at most 40 characters per line (tested for the worst case in both languages), with the SYNTHETIC label.

## Brain architecture
`brain.js` reuses `game.js` for learning, so one column of three honest membranes reproduces `episode()` draw for draw (tested). Each layer is a vote: 2f + 1 voters and a quorum of f + 1, the smallest size at which f colluding voters cannot release and the honest ones still can. `tests/brain.test.js` checks this by enumerating every placement. The release rule (earliest time, lowest index, one per episode) generalizes the 2-of-3 shield, and a test confirms it picks the same membrane. Microtubules carry released vectors with a delay in check periods and optional noise. Arrivals after step 60 are lost. Coupling defaults to 0 because it lets a faulty member pull honest ones toward its vector (measured: 313 false outputs in 1,000 episodes at 0.05). The output, inhibitory and memory membranes are assumed fault-free and reported as single points of failure. Details and measurements: [docs/BRAIN.md](docs/BRAIN.md), [docs/brain-check.txt](docs/brain-check.txt).

## Known weaknesses

- The game's scoring and the scheme bonus are design choices, not findings.
- Only width 32 is simulated; the repository's other widths are not shown.
- Eight episodes per generation make the evolution step noisy by construction; a single run is one sample.
- The daily result can be computed from the page source.
- Headless-Chrome checks run on software rendering; phone hardware was not tested.
- The brain architecture is sized for safety. At exactly 2f + 1 voters there is no spare honest voter, so recall falls at the fault bound (0.41 in `docs/brain-check.txt`). Its layout, fusion and fault-free output are design choices.
