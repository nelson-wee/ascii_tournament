/**
 * The event bus (dev-guide Sections 4.6 and 6.8).
 *
 * Events are the record. Systems emit events. Stats, progression, rivalries,
 * the kill feed, and the reports read the events. They do not read the
 * internal state of another system.
 */

/**
 * The minimum event types of Section 6.8, plus `Announcement`.
 *
 * `Announcement` carries a multi-kill, a killing spree, or the end of a spree.
 * The kill feed reads it (Section 7.17).
 */
export const GAME_EVENT_TYPES = [
  "MatchStart",
  "MatchEnd",
  "RoundStart",
  "RoundEnd",
  "Spawn",
  "Death",
  "Kill",
  "Assist",
  "Shot",
  "Hit",
  "Crit",
  "DotTick",
  "HazardCreated",
  "PickupTaken",
  "PickupRespawned",
  "DecisionChanged",
  "Announcement",
  "TraitGained",
  "RivalryStarted",
  "RivalryEventAdded",
  "NicknameGained",
] as const;

export type GameEventType = (typeof GAME_EVENT_TYPES)[number];

/**
 * One event.
 *
 * Each system defines the shape of its own `data` field at its milestone.
 * The field stays open until then, because the context fields are not set
 * (for example, the `Kill` context of Section 6.8 arrives with M3).
 */
export interface GameEvent<T extends GameEventType = GameEventType> {
  readonly type: T;
  readonly tick: number;
  readonly roundNumber: number;
  readonly data: Readonly<Record<string, unknown>>;
}

export type EventHandler = (event: GameEvent) => void;

/**
 * A synchronous event bus with a log.
 *
 * Determinism: the bus calls the handlers in the order of subscription, and
 * it delivers each event before it accepts the next one.
 */
export class EventBus {
  private readonly events: GameEvent[] = [];
  private readonly byType = new Map<GameEventType, EventHandler[]>();
  private readonly anyHandlers: EventHandler[] = [];

  /** All events, oldest first. */
  get log(): readonly GameEvent[] {
    return this.events;
  }

  /** Add an event to the log and call the handlers. */
  emit(
    type: GameEventType,
    tick: number,
    roundNumber: number,
    data: Readonly<Record<string, unknown>> = {},
  ): GameEvent {
    const event: GameEvent = { type, tick, roundNumber, data };
    this.events.push(event);
    for (const handler of this.byType.get(type) ?? []) handler(event);
    for (const handler of this.anyHandlers) handler(event);
    return event;
  }

  /** Listen to one event type. Returns a function that removes the handler. */
  on(type: GameEventType, handler: EventHandler): () => void {
    const handlers = this.byType.get(type);
    if (handlers) handlers.push(handler);
    else this.byType.set(type, [handler]);
    return () => this.off(type, handler);
  }

  /** Listen to all event types. Returns a function that removes the handler. */
  onAny(handler: EventHandler): () => void {
    this.anyHandlers.push(handler);
    return () => {
      const index = this.anyHandlers.indexOf(handler);
      if (index >= 0) this.anyHandlers.splice(index, 1);
    };
  }

  /** Remove one handler of one event type. */
  off(type: GameEventType, handler: EventHandler): void {
    const handlers = this.byType.get(type);
    if (!handlers) return;
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  }

  /** All logged events of one type. */
  filter(type: GameEventType): GameEvent[] {
    return this.events.filter((event) => event.type === type);
  }

  /** Remove all logged events. Handlers stay. */
  clearLog(): void {
    this.events.length = 0;
  }

  /** Remove all logged events and all handlers. */
  reset(): void {
    this.clearLog();
    this.byType.clear();
    this.anyHandlers.length = 0;
  }
}
