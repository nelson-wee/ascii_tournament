/** Simulation module (dev-guide Section 7.4). */
export * from "./state.js";
export { advanceBot } from "./movement.js";
export {
  hitChance,
  isInCover,
  rangeBandOf,
  respawn,
  selectTarget,
  tryFire,
} from "./combat.js";
export { checkRoundEnd, runRound, step, stepMany, type RoundResult } from "./round.js";
