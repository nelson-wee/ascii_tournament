import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, GAME_EVENT_TYPES, type GameEvent } from "../src/core/events.js";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it("has all event types of Section 6.8", () => {
    for (const type of [
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
      "TraitGained",
      "RivalryStarted",
      "RivalryEventAdded",
      "NicknameGained",
    ]) {
      expect(GAME_EVENT_TYPES).toContain(type);
    }
  });

  it("logs the events in order", () => {
    bus.emit("RoundStart", 0, 1);
    bus.emit("Shot", 3, 1, { shooterId: "a" });
    bus.emit("Kill", 5, 1, { killerId: "a", victimId: "b" });
    expect(bus.log.map((event) => event.type)).toEqual(["RoundStart", "Shot", "Kill"]);
    expect(bus.log[1]?.tick).toBe(3);
    expect(bus.log[2]?.data["victimId"]).toBe("b");
  });

  it("calls only the handlers of the emitted type", () => {
    const onKill = vi.fn();
    const onShot = vi.fn();
    bus.on("Kill", onKill);
    bus.on("Shot", onShot);
    bus.emit("Kill", 1, 1);
    expect(onKill).toHaveBeenCalledTimes(1);
    expect(onShot).not.toHaveBeenCalled();
  });

  it("calls the handlers in the order of subscription", () => {
    const order: string[] = [];
    bus.on("Kill", () => order.push("first"));
    bus.on("Kill", () => order.push("second"));
    bus.onAny(() => order.push("any"));
    bus.emit("Kill", 1, 1);
    expect(order).toEqual(["first", "second", "any"]);
  });

  it("removes a handler with off() and with the returned function", () => {
    const handler = vi.fn();
    const unsubscribe = bus.on("Hit", handler);
    bus.emit("Hit", 1, 1);
    unsubscribe();
    bus.emit("Hit", 2, 1);
    expect(handler).toHaveBeenCalledTimes(1);

    const second = vi.fn();
    bus.on("Hit", second);
    bus.off("Hit", second);
    bus.emit("Hit", 3, 1);
    expect(second).not.toHaveBeenCalled();
  });

  it("removes an onAny handler", () => {
    const handler = vi.fn();
    const unsubscribe = bus.onAny(handler);
    bus.emit("Spawn", 0, 1);
    unsubscribe();
    bus.emit("Spawn", 1, 1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("filters the log by type", () => {
    bus.emit("Shot", 1, 1);
    bus.emit("Kill", 2, 1);
    bus.emit("Shot", 3, 1);
    expect(bus.filter("Shot")).toHaveLength(2);
    expect(bus.filter("Assist")).toHaveLength(0);
  });

  it("clears the log but keeps the handlers", () => {
    const handler = vi.fn();
    bus.on("Death", handler);
    bus.emit("Death", 1, 1);
    bus.clearLog();
    expect(bus.log).toHaveLength(0);
    bus.emit("Death", 2, 1);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(bus.log).toHaveLength(1);
  });

  it("removes the log and the handlers on reset", () => {
    const handler = vi.fn();
    bus.on("Death", handler);
    bus.onAny(handler);
    bus.emit("Death", 1, 1);
    bus.reset();
    bus.emit("Death", 2, 1);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(bus.log).toHaveLength(1);
  });

  it("gives the same event object to the handler and to the log", () => {
    let received: GameEvent | null = null;
    bus.on("Crit", (event) => {
      received = event;
    });
    const emitted = bus.emit("Crit", 4, 2, { damage: 90 });
    expect(received).toBe(emitted);
    expect(bus.log[0]).toBe(emitted);
    expect(emitted.roundNumber).toBe(2);
  });

  it("delivers one event fully before the next one", () => {
    // Determinism: a handler that emits must not interleave with the events
    // that follow it.
    const seen: string[] = [];
    bus.on("Kill", () => bus.emit("RivalryEventAdded", 1, 1));
    bus.onAny((event) => seen.push(event.type));
    bus.emit("Kill", 1, 1);
    bus.emit("RoundEnd", 2, 1);
    expect(seen).toEqual(["RivalryEventAdded", "Kill", "RoundEnd"]);
  });
});
