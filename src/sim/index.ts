/** Simulation module (dev-guide Section 7.4). */
export * from "./state.js";
export { advanceBot } from "./movement.js";
export {
  critConditionMet,
  currentBand,
  dodgeOf,
  effectiveReaction,
  hitChance,
  isInCover,
  rangeBandOf,
  respawn,
  selectTarget,
  tryFire,
} from "./combat.js";
export { damageBot, applyDot } from "./damage.js";
export {
  applyAreaDamage,
  applyConeDamage,
  applyDots,
  applyHazards,
  applyLineDamage,
  clearLine,
  createHazard,
  spawnProjectile,
  updateProjectiles,
} from "./attacks.js";
export {
  checkRoundEnd,
  enterSuddenDeathIfNeeded,
  runRound,
  step,
  stepMany,
  type RoundResult,
} from "./round.js";
