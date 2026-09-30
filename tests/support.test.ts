/**
 * Support: joining a fight a teammate is already in (dev-guide Section 7.44).
 */
import { describe, expect, it } from "vitest";
import { applyAction, scoreActions } from "../src/ai/utility.js";
import { updatePerception } from "../src/ai/perception.js";
import { parseArenaText } from "../src/arena/textArena.js";
import { loadBaselineWeapon, loadDefaultTactics, loadRoles } from "../src/core/data.js";
import { EventBus } from "../src/core/events.js";
import { createRng, deriveSeed } from "../src/core/rng.js";
import { generateWeaponSet } from "../src/weapons/generate.js";
import { createSimState, distanceBetween, type BotState, type SimState } from "../src/sim/index.js";

const W = 50;
const row = (seed: string) => `#${seed.padEnd(W - 2, ".")}#`;
// An armor point far down the hall, so `SeekPickup` has something to score, and
// far enough that the suppression of Section 7.44.3 applies to it.
const HALL = [
  "#".repeat(W),
  row("SSS"),
  `#${".".repeat(34)}A${".".repeat(W - 37)}#`,
  row("SSS"),
  "#".repeat(W),
].join("\n");

interface Scene {
  state: SimState;
  /** The bot that is not fighting. */
  helper: BotState;
  /** The teammate that is. */
  mate: BotState;
}

/**
 * A long hall: one teammate in a fight at the far end, one helper at the near
 * end, and `enemies` live opponents beside the teammate.
 */
function scene(options: {
  role?: "overwatch" | "tank" | "skirmisher";
  enemies?: number;
  mateHealth?: number;
  helperAt?: number;
  weapons?: boolean;
} = {}): Scene {
  const state = createSimState({
    map: parseArenaText(HALL, { source: "support" }),
    seed: 5,
    bus: new EventBus(),
    tacticsOverride: loadDefaultTactics(),
    ...(options.weapons === true
      ? { weapons: generateWeaponSet(createRng(deriveSeed(9, "w"), "weapons"), 5) }
      : {}),
  });
  const helper = state.bots[0] as BotState;
  const mate = state.bots[1] as BotState;
  (state.bots[2] as BotState).alive = false;
  if (options.role) {
    const roles = loadRoles();
    helper.tactics = roles.roles[options.role]!.tactics as never;
    helper.roleBehavior = roles.roles[options.role]!.behavior;
  }
  helper.pos = { x: (options.helperAt ?? 3) + 0.5, y: 2.5 };
  mate.pos = { x: 40.5, y: 2.5 };
  mate.health = options.mateHealth ?? 100;
  const foes = [state.bots[3], state.bots[4], state.bots[5]] as BotState[];
  foes.forEach((foe, i) => {
    foe.alive = i < (options.enemies ?? 1);
    foe.pos = { x: 43.5 + i, y: 2.5 };
  });
  updatePerception(state);
  return { state, helper, mate };
}

const scoreOf = (state: SimState, bot: BotState, kind: string): number =>
  scoreActions(state, bot).find((candidate) => candidate.action.kind === kind)?.score ?? 0;

describe("when Support is offered at all", () => {
  it("is offered to a bot whose teammate is fighting", () => {
    const { state, helper } = scene({ role: "tank" });
    expect(scoreOf(state, helper, "Support")).toBeGreaterThan(0);
  });

  it("is not offered when the bot has an enemy of its own", () => {
    // Then Engage and Chase are the actions for it.
    const { state, helper } = scene({ role: "tank", helperAt: 41 });
    expect(helper.visibleEnemyIds.length).toBeGreaterThan(0);
    expect(scoreOf(state, helper, "Support")).toBe(0);
  });

  it("is not offered when no teammate can see an enemy", () => {
    const { state, helper } = scene({ role: "tank", enemies: 0 });
    expect(scoreOf(state, helper, "Support")).toBe(0);
  });

  it("is not offered when the bot is already inside its own band of the fight", () => {
    // There is no ground to cover, so HoldPosition and TakePosition decide.
    const { state, helper, mate } = scene({ role: "tank", helperAt: 38 });
    expect(distanceBetween(helper, mate)).toBeLessThan(4);
    expect(scoreOf(state, helper, "Support")).toBe(0);
  });
});

describe("how urgent the fight is", () => {
  it("rises with the number of enemies the teammate faces", () => {
    const one = scene({ role: "tank", enemies: 1 });
    const two = scene({ role: "tank", enemies: 2 });
    expect(scoreOf(two.state, two.helper, "Support")).toBeGreaterThan(
      scoreOf(one.state, one.helper, "Support"),
    );
  });

  it("rises with the health the teammate has lost", () => {
    const whole = scene({ role: "tank", mateHealth: 100 });
    const hurt = scene({ role: "tank", mateHealth: 30 });
    expect(scoreOf(hurt.state, hurt.helper, "Support")).toBeGreaterThan(
      scoreOf(whole.state, whole.helper, "Support"),
    );
  });

  it("falls with the distance to the fight", () => {
    // Both helpers must be blind to the enemy, or the nearer one gets its own
    // target and Support is withheld from it by design. The sight radius is 26
    // cells and the enemy stands at 43.5.
    const near = scene({ role: "tank", helperAt: 12 });
    const far = scene({ role: "tank", helperAt: 3 });
    expect(near.helper.visibleEnemyIds).toHaveLength(0);
    expect(far.helper.visibleEnemyIds).toHaveLength(0);
    expect(scoreOf(near.state, near.helper, "Support")).toBeGreaterThan(
      scoreOf(far.state, far.helper, "Support"),
    );
  });
});

describe("the role decides how far it will travel", () => {
  it("scores Support lowest for the role that holds ground", () => {
    // The caveat of the request: a bot weighted toward covering a zone should
    // not displace to a fight across the arena.
    const tank = scene({ role: "tank", enemies: 2, mateHealth: 40 });
    const skirmisher = scene({ role: "skirmisher", enemies: 2, mateHealth: 40 });
    const overwatch = scene({ role: "overwatch", enemies: 2, mateHealth: 40 });
    const score = (s: Scene) => scoreOf(s.state, s.helper, "Support");
    expect(score(tank)).toBeGreaterThan(score(overwatch));
    expect(score(skirmisher)).toBeGreaterThan(score(overwatch));
  });

  it("stops short of the teammate rather than on top of it", () => {
    const { state, helper, mate } = scene({ role: "tank", enemies: 2, mateHealth: 40 });
    const action = scoreActions(state, helper).find((c) => c.action.kind === "Support")?.action;
    expect(action).toBeDefined();
    applyAction(state, helper, action!);
    expect(helper.pathGoal).not.toBeNull();
    const short = mate.pos.x - (helper.pathGoal!.x + 0.5);
    expect(short).toBeGreaterThan(1);
  });
});

describe("a fight suppresses a far pickup run (Section 7.44.3)", () => {
  it("lowers SeekPickup for an armed bot when a teammate is fighting", () => {
    const fighting = scene({ role: "tank", weapons: true, enemies: 2, mateHealth: 40 });
    const quiet = scene({ role: "tank", weapons: true, enemies: 0 });
    for (const s of [fighting, quiet]) {
      // Two weapons means armed: the baseline plus one taken from the ground.
      s.helper.weapons = [loadBaselineWeapon(), s.state.runWeapons[1]!];
    }
    expect(scoreOf(fighting.state, fighting.helper, "SeekPickup")).toBeLessThan(
      scoreOf(quiet.state, quiet.helper, "SeekPickup"),
    );
  });

  it("never lowers it for a bot still on the starting rifle", () => {
    // The safety valve of Section 7.41: an unarmed bot joining a fight is a
    // gift to the other team, so it fetches its weapon first.
    const fighting = scene({ role: "tank", weapons: true, enemies: 2, mateHealth: 40 });
    const quiet = scene({ role: "tank", weapons: true, enemies: 0 });
    for (const s of [fighting, quiet]) s.helper.weapons = [loadBaselineWeapon()];
    expect(scoreOf(fighting.state, fighting.helper, "SeekPickup")).toBeCloseTo(
      scoreOf(quiet.state, quiet.helper, "SeekPickup"),
      6,
    );
  });
});
