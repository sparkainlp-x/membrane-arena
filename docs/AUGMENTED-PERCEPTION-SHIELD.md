# Augmented-perception shield

A prototype wiring an augmented-perception system — for example Alexandra Bernadotte's ZEUS (brain-computer interface
with augmented intelligence) through the Membrane Arena shield and out to
a holographic fan — so what the system perceives is only projected in shared
light when the shield has grounds to trust it.

## The pipeline

Per episode, three perception channels — VISUAL (sees), ACOUSTIC
(hears), CONTEXT (knows where you are) — each declare a vector, via the
game's real `episode()` (membranes 0, 1, 2). Then the full shield:

1. **2-of-3 vote** (`systemEvent`, AGREE = 0.4). No consensus → abstain.
2. **Collision guard** (`pairwiseCollision`, COLLIDE = 0.9,
   COLL_MARGIN = 0.05). A localised collision is one witness counted
   twice → abstain.
3. **Reference channel** (M = 20 clean samples from the true pattern,
   never the disturbance; confirms when the mean energy ratio reaches
   the game's declaration threshold, 3.91). No confirm → abstain.

PROJECT means the fan shows the perception in light, shared with
everyone in the room. ABSTAIN means nothing is projected.

## Measured (K = 500/arm, repo-start params th 0.5, c 0.05, g 1.0)

| arm | project | no-consensus | collision | no-reference |
|---|---|---|---|---|
| signal | **91.6%** | 30 | 7 | 5 |
| artifact | **0.0%** | 23 | 6 | 471 |
| collision | **64.2%** | 31 | 144 | 4 |
| noise | **0.0%** | 500 | 0 | 0 |

Run it: `node scripts/augmented-perception-shield.js` (exit 0 = PASS).

## What it means

- The fan projects the real signal (91.6%) and **never** projects the
  artifact (0.0%) or noise. The reference channel does that work: it
  refuses the disturbance 471 times out of 500.
- The collision guard is **partial by design**. It fires on 144 of the
  planted collisions, but when the third channel agrees the collision
  becomes global consensus and is indistinguishable from a real signal —
  so the fan still projects 64.2% of planted collisions. The guard
  reduces collision projection (92% vote-only → 64%), it does not
  eliminate it. That is the honest limit, and it is the same limit the
  collision guard has in the game itself (see `docs/COLLISION-GUARD.md`).

## Reference (inspiration, not a partnership)

The idea was sparked by Alexandra Bernadotte's ZEUS — a brain-computer
interface with augmented intelligence (Aicumene), presented in her
LinkedIn post of 9 November 2026 ("What if you could see more than
your eyes can see?"). ZEUS is her product, not ours, and no code,
text, or image of hers is used here. The shield is our own work
(Membrane Arena), and ZEUS is named here only as the example of an
augmented-perception system the shield could work with. The public
post and the Perception Shield game do not mention her — the reference
lives in this file.

## Status

Prototype only, on branch `augmented-perception-shield`. PR pending —
merging is Jean's call. The perception side is simulated — the three channels are
the game's membranes, not a real brain-computer interface. The shield
side is real: it calls the game's exported `episode()`, `systemEvent()`,
`pairwiseCollision()`, and the reference-confirm computation from
`lab.js`'s `referenceProbe`.

Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
