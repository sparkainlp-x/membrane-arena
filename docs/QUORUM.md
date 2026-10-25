# Quorum Keeper: build brains that outvote faults, then break them

Quorum Keeper is a logic puzzle built on the brain architecture page ([BRAIN.md](BRAIN.md)). It is a game on a SYNTHETIC classical simulation. The membranes and microtubules are metaphors: nothing here models real neurons, real microtubules or a brain, and nothing was measured on hardware.

Open `dist/quorum.html` in a browser. It is one offline file: no network requests, nothing stored. Progress lasts until you close the page.

## How a brain votes

Every layer votes, using the brain page's rule. A gate releases a vector when a strict majority of its column's sensory members agree. An integrator releases when a strict majority of the columns agree. The output releases when a strict majority of the integrators agree. Each microtubule adds a delay, and anything that would reach the output after step 60 is lost.

Faulty units come in three kinds:

- **collude**: they all send the same wrong vector, so they can outvote the truth;
- **stuck**: each sends its own random vector, so they never agree with each other;
- **silent**: they send nothing, so they can starve a vote but never fool it.

The output and the inhibitory membrane are never faulty.

## Build levels: survive the adversary

You choose sensory members per column, columns, integrators, and whether to add the inhibitory membrane. Each membrane costs 1 against the level's budget. Press **Test against the adversary**:

1. The adversary tries **every** placement of faults the level allows. If any placement fools the brain or leaves it silent, you get no star, and the diagram shows the smallest placement that does it.
2. If the logic holds (1 star), the brain runs with the arena's real learning membranes for 60 seeded episodes, half with a hidden pattern. Faults sit at the placement that leaves the honest units the least to spare. Reaching the level's recall target earns a 2nd star.
3. Doing it within par earns the 3rd star.

| Level | Threat | Budget | Recall target | Par | Lesson |
|---|---|---|---|---|---|
| B1 One liar | 1 sensory member per column | 8 | 0.60 | 6 | 2f + 1 members per column |
| B2 A rogue column | 1 gate | 10 | 0.60 | 9 | count columns, and the inhibitory membrane helps |
| B3 Both at once | 1 member per column and 1 gate | 22 | 0.90 | 21 | spare members above the minimum |
| B4 Anywhere, once | 1 fault in all, anywhere | 14 | 0.85 | 11 | a single fault needs only a single layer of redundancy |
| B5 Quiet saboteurs | silent: 1 member per column and 1 gate | 28 | 0.95 | 27 | silence costs votes, so it needs more spares |
| B6 Slow links | 1 member per column, gate-to-integrator delay 3 | 16 | 0.35 | 11 | delay eats the time to declare |
| B7 Twice, anywhere | 2 faults in all, anywhere | 24 | 0.95 | 17 | spend redundancy where the threat is |

## Break levels: be the adversary

You get a fixed brain, a goal (fool it, or silence it), a fault budget and the kinds of unit you may hit. Tap units to mark them faulty, or focus one and press Enter. Then press **Attack**, or **It cannot be done** if you think no placement works. Stars: 1 for reaching the goal (or for a correct claim), 1 more if your first try is right, 1 more for using the fewest faults possible. After a miss, **Show a way** reveals a smallest working placement.

Two of the seven (X4 and X6) cannot be broken: there the right move is the claim. X1 shows why an even number of voters is no safer than one fewer. X2, X5 and X7 reward finding the cheapest layer to attack.

## What the level search found

These come from [quorum-check.txt](quorum-check.txt), which tries every design within the limits (1-9 members per column, 1-7 columns, 1-5 integrators, inhibitory on or off) for each level:

- **The minimum is safe but slow.** In B3 the cheapest safe brain (3 members x 3 columns, 14 membranes) passes every one of the 256 placements, but the measured recall is low. The cheapest design that reaches 0.90 is 5 x 3 with the inhibitory membrane (21 membranes, recall 0.93). The brain page found the same thing: at exactly 2f + 1 there are no spare honest voters.
- **The inhibitory membrane mattered more than an extra unit.** Table C turns it on and off at each level's par design, on three seeds. It raised recall in all 21 pairs, for example from 0.53, 0.47 and 0.40 to 0.93, 0.80 and 0.80 in B3. Under slow links (B6) the brain without it reached recall 0.00, 0.03 and 0.00, and 0.37, 0.37 and 0.30 with it. This is a measurement in this simulation. The membrane scales every sensory gain from the output rate, and the search did not isolate why that helps so much here.
- **Where the membranes go matters more than how many.** In B3, 3 members x 4 columns with 2 integrators and the inhibitory membrane (20 membranes) reached recall 0.33, while 5 x 3 with 1 integrator and the inhibitory membrane (21) reached 0.93. Extra integrators fed by the same columns release together and add safety, not recall. A 4th column needs 3 of 4 columns to agree, the same as 3 of 5. Spare members inside each column are what let a gate release early.
- **No design that passed the logic gave a false output** in any simulation the search ran.

## How the game decides

- **The logic is symbolic.** Honest sensory members declare the true vector at the first check. Faulty ones follow their mode. Every vote applies the strict-majority rule with the microtubule delays and the step-60 deadline. A test checks this against the brain page's own logic on 2,000 random brains and placements.
- **The adversary is exhaustive.** Members of a column, columns and integrators are interchangeable for the vote, so the search groups placements that must give the same result and counts how many each group stands for. Tests compare the counts and the smallest counterexamples with a brute force over every subset on small brains.
- **Recall is a game score.** It is one seeded run of 60 episodes (30 with the pattern), so the confidence intervals in the report are wide (about plus or minus 0.15). Targets and pars are tuned to each level's own seed. On other seeds the par design of B3 reached 0.80 against a target of 0.90, and B5's reached 0.93 against 0.95 (table C). Recall does not estimate anything outside this simulation.

## Assumptions

- Honest members are modelled as declaring at the first check in the logic. In the simulation they declare when the learning membrane does, which can be later or never; that is what recall measures.
- The output and the inhibitory membrane are assumed fault-free, as on the brain page.
- In-column coupling is 0, as on the brain page, because coupling leaks faults through the vote.
- The memory membrane is not used in the game.

## Run and check it

```
node build.js                              # writes dist/index.html, dist/brain.html, dist/quorum.html
node --test tests/*.test.js                # all tests, including tests/quorum.test.js and tests/quorumpage.test.js
node scripts/quorum-check.js --write       # rewrites docs/quorum-check.txt (about 1 minute)
PLAYWRIGHT_CORE=/path/to/playwright-core node scripts/quorum-e2e-check.js   # headless Chrome playthrough
```

The playthrough solves levels by clicking in English and French, on phone and desktop sizes, once in high contrast and once by keyboard. It writes `docs/quorum-e2e-report.json` and screenshots in `docs/screenshots/quorum-*.png`.

Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
