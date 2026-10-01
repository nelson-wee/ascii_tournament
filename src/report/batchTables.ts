/**
 * The terminal tables and the CSV files of the batch harness
 * (dev-guide Section 7.16).
 */
import { tempoView, type TempoRecord } from "./tempo.js";
import type { RoundRecord, BatchSummary, WinRecord } from "./batchStats.js";
import {
  archetypeBandShareOf,
  archetypesOf,
  bandShareOf,
  standardError,
  winRate,
} from "./batchStats.js";

/** The three range bands, in the order every table prints them. */
const BANDS = ["close", "mid", "long"] as const;

function pad(text: string, width: number, right = false): string {
  return right ? text.padStart(width) : text.padEnd(width);
}

/** A table with a header line and a rule under it. */
function table(headers: string[], rows: string[][], rightAlign: boolean[] = []): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const line = (cells: string[]): string =>
    cells
      .map((cell, column) => pad(cell, widths[column] ?? 0, rightAlign[column] ?? false))
      .join("  ")
      .trimEnd();
  return [line(headers), widths.map((width) => "-".repeat(width)).join("  "), ...rows.map(line)].join(
    "\n",
  );
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}

function rateCell(value: WinRecord | undefined): string {
  if (!value || value.rounds === 0) return "-";
  return `${percent(winRate(value))} ±${(standardError(value) * 100).toFixed(1)}`;
}

/**
 * One measure of the band table: the share in each band, then the total.
 *
 * The share drops an unknown band rather than folding it into a real one, so a
 * total that does not match the three shares is a defect and reads as one.
 */
function bandRow(name: string, totals: Map<string, number>): string[] {
  const share = bandShareOf(totals);
  const total = BANDS.reduce((sum, band) => sum + (totals.get(band) ?? 0), 0);
  return [
    name,
    percent(share.close),
    percent(share.mid),
    percent(share.long),
    total >= 1000 ? total.toFixed(0) : total.toFixed(1),
  ];
}

/** Every table of the batch report, as one block of text. */
export function formatReport(summary: BatchSummary): string {
  const parts: string[] = [];

  parts.push(
    table(
      ["rounds", "mean ticks", "mean kills", "mean shots", "hits per shot", "kills from behind"],
      [
        [
          String(summary.rounds),
          summary.meanTicks.toFixed(0),
          summary.meanKills.toFixed(1),
          summary.meanShots.toFixed(0),
          summary.hitsPerShot.toFixed(2),
          percent(summary.unawareKillShare),
        ],
      ],
      [true, true, true, true, true, true],
    ),
  );

  // Win rate per preset and arena. This is the matrix of Section 7.16.
  parts.push(
    "WIN RATE: tactics preset x arena\n" +
      table(
        ["preset", ...summary.arenas, "all"],
        summary.presets.map((preset) => [
          preset,
          ...summary.arenas.map((arena) => rateCell(summary.byPresetArena.get(`${preset}|${arena}`))),
          rateCell(summary.byPreset.get(preset)),
        ]),
        [false, ...summary.arenas.map(() => true), true],
      ),
  );

  // Win rate of the team on the left against the team on the top.
  for (const arena of summary.arenas) {
    parts.push(
      `MATCHUPS on ${arena}: the row is team A, the column is team B\n` +
        table(
          ["team A \\ team B", ...summary.presets],
          summary.presets.map((rowPreset) => [
            rowPreset,
            ...summary.presets.map((columnPreset) =>
              rateCell(summary.byMatchup.get(`${arena}|${rowPreset}|${columnPreset}`)),
            ),
          ]),
          [false, ...summary.presets.map(() => true)],
        ),
    );
  }

  // Win rate per role composition. This is the acceptance test of M8: the
  // batch shows a different result by role composition (Section 7.11). One
  // composition alone says nothing, so the table is left out then.
  if (summary.compositions.length > 1) {
    parts.push(
      "WIN RATE: role composition\n" +
        table(
          ["composition", "all"],
          summary.compositions.map((composition) => [
            composition,
            rateCell(summary.byComposition.get(composition)),
          ]),
          [false, true],
        ),
    );
    parts.push(
      "COMPOSITION MATCHUPS: the row is team A, the column is team B\n" +
        table(
          ["team A \\ team B", ...summary.compositions],
          summary.compositions.map((row) => [
            row,
            ...summary.compositions.map((column) =>
              rateCell(summary.byCompositionMatchup.get(`${row}|${column}`)),
            ),
          ]),
          [false, ...summary.compositions.map(() => true)],
        ),
    );
  }

  const reasons = [...summary.byReason.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  parts.push(
    "ROUND END\n" +
      table(
        ["reason", "rounds", "share"],
        reasons.map(([reason, count]) => [
          reason,
          String(count),
          percent(summary.rounds === 0 ? 0 : count / summary.rounds),
        ]),
        [false, true, true],
      ),
  );

  const archetypes = [...summary.killsByArchetype.entries()].sort((a, b) => b[1] - a[1]);
  const totalKills = archetypes.reduce((sum, [, count]) => sum + count, 0);
  parts.push(
    "KILLS BY WEAPON ARCHETYPE\n" +
      table(
        ["archetype", "kills", "share"],
        archetypes.map(([archetype, count]) => [
          archetype,
          String(count),
          percent(totalKills === 0 ? 0 : count / totalKills),
        ]),
        [false, true, true],
      ),
  );

  // Section 7.46: the four measures of where a round fights, side by side.
  // `value.bandShare` says "how often the arena FIRES in each band", so the
  // shots row is the one that number answers to. The other three are the check
  // on it: kills alone made a long-range weapon look useful on a map that never
  // fired long, because a long kill is still a kill.
  parts.push(
    "RANGE BANDS: where the round fought\n" +
      table(
        ["measure", ...BANDS, "total"],
        [
          bandRow("shots", summary.byBand.shots),
          bandRow("hits", summary.byBand.hits),
          bandRow("damage", summary.byBand.damage),
          bandRow("kills", summary.byBand.kills),
        ],
        [false, true, true, true, true],
      ),
  );

  // Section 7.46.4: the share each archetype fires in each band, which is the
  // number the power budget needs and `value.bandShare` does not hold. A global
  // share under-prices a specialist: a cone fires 76 % of its shots close, and
  // the arena as a whole fires 23 % of its shots there.
  const bandArchetypes = archetypesOf(summary.shotsByArchetypeBand);
  if (bandArchetypes.length > 0) {
    parts.push(
      "RANGE BANDS BY ARCHETYPE: where each weapon kind chooses to fire\n" +
        table(
          ["archetype", ...BANDS, "shots", "damage"],
          bandArchetypes.map((archetype) => {
            const share = archetypeBandShareOf(summary.shotsByArchetypeBand, archetype);
            const damage = summary.damageByArchetype.get(archetype) ?? 0;
            return [
              archetype,
              percent(share.close),
              percent(share.mid),
              percent(share.long),
              String(share.shots),
              damage.toFixed(0),
            ];
          }),
          [false, true, true, true, true, true],
        ),
    );
  }

  const weapons = [...summary.shotsByWeapon.entries()].sort((a, b) => b[1] - a[1]);
  const totalShots = weapons.reduce((sum, [, count]) => sum + count, 0);
  parts.push(
    "WEAPON USE\n" +
      table(
        ["weapon", "shots", "share"],
        weapons.map(([weapon, count]) => [
          weapon,
          String(count),
          percent(totalShots === 0 ? 0 : count / totalShots),
        ]),
        [false, true, true],
      ),
  );

  // The rhythm of a round (Section 7.22). Every other table here is a total,
  // and a total cannot tell a steady drip of kills from a set of short fights.
  const tempo = tempoView(summary.tempo, summary.rounds);
  const rate = Math.max(1, summary.ticksPerSecond);
  const seconds = (ticks: number): string => (ticks / rate).toFixed(1);
  parts.push(
    "TEMPO: the rhythm of a round\n" +
      table(
        ["kill gap", "burstiness", "in a burst", "trades", "time to kill", "shots to kill"],
        [
          [
            `${seconds(tempo.killGapMean)} s`,
            tempo.burstiness.toFixed(2),
            percent(tempo.burstShare),
            percent(tempo.tradeShare),
            `${seconds(tempo.timeToKill)} s`,
            tempo.shotsToKill.toFixed(1),
          ],
        ],
        [true, true, true, true, true, true],
      ) +
      "\n" +
      table(
        ["first shot", "first kill", "dead", "walk back", "in contact"],
        [
          [
            `${seconds(tempo.openingTicks)} s`,
            `${seconds(tempo.firstKillTick)} s`,
            `${seconds(tempo.deadTicks)} s`,
            `${seconds(tempo.returnTicks)} s`,
            percent(tempo.contactShare),
          ],
        ],
        [true, true, true, true, true],
      ) +
      "\n" +
      table(
        ["lead changes", "largest lead", "next kill to the same team"],
        [[tempo.leadChanges.toFixed(1), tempo.maxLead.toFixed(1), percent(tempo.sameTeamNext)]],
        [true, true, true],
      ),
  );

  const waits = Object.keys(tempo.pickupWait).sort();
  if (waits.length > 0) {
    parts.push(
      "ITEM RHYTHM: how long a point waits after it comes back\n" +
        table(
          ["kind", "mean wait", "takes"],
          waits.map((kind) => [
            kind,
            `${seconds(tempo.pickupWait[kind] ?? 0)} s`,
            String(summary.tempo.pickupWaitCount[kind] ?? 0),
          ]),
          [false, true, true],
        ),
    );
  }

  const warnings: string[] = [...summary.balanceFailures];
  if (summary.lowKillRounds > 0) {
    warnings.push(
      `${summary.lowKillRounds} rounds made very few kills. Section 7.2.1: a round with ` +
        "almost no kill is a defect, not a close match.",
    );
  }
  parts.push(
    warnings.length === 0
      ? "BALANCE: no failure found."
      : `BALANCE FAILURES\n${warnings.map((line) => `  ! ${line}`).join("\n")}`,
  );

  parts.push(`NOT MEASURED YET\n${summary.missingReports.map((line) => `  - ${line}`).join("\n")}`);

  return parts.join("\n\n");
}

function csv(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell);
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(","),
    )
    .join("\n")
    .concat("\n");
}

/**
 * The tempo fields that go in a round row, in order. They are the numeric
 * fields of `TempoRecord`; the two by-kind records get their own columns.
 */
const TEMPO_COLUMNS = [
  "firstKillTick",
  "openingTicks",
  "kills",
  "killGaps",
  "killGapSum",
  "killGapSquareSum",
  "burstKills",
  "tradeKills",
  "engagements",
  "timeToKillSum",
  "shotsToKillSum",
  "deaths",
  "deadTicksSum",
  "returns",
  "returnTicksSum",
  "aliveTicksSum",
  "contactTicksSum",
  "leadChanges",
  "maxLead",
  "killPairs",
  "sameTeamPairs",
] as const satisfies readonly (keyof TempoRecord)[];

/** One row per round. */
export function roundsCsv(records: readonly RoundRecord[]): string {
  const archetypes = [
    ...new Set(records.flatMap((round) => Object.keys(round.killsByArchetype))),
  ].sort();
  const roles = [
    ...new Set(
      records.flatMap((round) => [
        ...Object.keys(round.killsByRole),
        ...Object.keys(round.deathsByRole),
        ...Object.keys(round.shotsByRole),
        ...Object.keys(round.hitsByRole),
        ...Object.keys(round.damageByRole),
      ]),
    ),
  ].sort();
  const kinds = [...new Set(records.flatMap((round) => Object.keys(round.pickupsByKind)))].sort();
  const rows: (string | number)[][] = [
    [
      "seed",
      "arena",
      "teamA",
      "teamB",
      "compA",
      "compB",
      "winner",
      "reason",
      "ticks",
      "scoreA",
      "scoreB",
      "shots",
      "hits",
      "unawareKills",
      "killsClose",
      "killsMid",
      "killsLong",
      // Section 7.46: where the round FIRED, not only where it finished.
      "shotsClose",
      "shotsMid",
      "shotsLong",
      "hitsClose",
      "hitsMid",
      "hitsLong",
      "damageClose",
      "damageMid",
      "damageLong",
      "killDistanceSum",
      ...roles.map((role) => `kills_role_${role}`),
      ...roles.map((role) => `deaths_role_${role}`),
      ...roles.map((role) => `shots_role_${role}`),
      ...roles.map((role) => `hits_role_${role}`),
      ...roles.map((role) => `damage_role_${role}`),
      ...kinds.map((kind) => `pickups_${kind}`),
      "archetypesInSet",
      ...archetypes.map((archetype) => `kills_${archetype}`),
      // Tempo, as sums and counts, so a reader can take the means over any
      // group of rounds (Section 7.22).
      ...TEMPO_COLUMNS,
      ...kinds.map((kind) => `pickupWaitCount_${kind}`),
      ...kinds.map((kind) => `pickupWaitTicks_${kind}`),
    ],
  ];
  for (const round of records) {
    rows.push([
      round.seed,
      round.arena,
      round.teamA,
      round.teamB,
      round.compA,
      round.compB,
      round.winner ?? "draw",
      round.reason,
      round.ticks,
      round.scoreA,
      round.scoreB,
      round.shots,
      round.hits,
      round.unawareKills,
      round.killsByBand["close"] ?? 0,
      round.killsByBand["mid"] ?? 0,
      round.killsByBand["long"] ?? 0,
      ...BANDS.map((band) => round.shotsByBand[band] ?? 0),
      ...BANDS.map((band) => round.hitsByBand[band] ?? 0),
      ...BANDS.map((band) => (round.damageByBand[band] ?? 0).toFixed(1)),
      round.killDistanceSum.toFixed(2),
      ...roles.map((role) => round.killsByRole[role] ?? 0),
      ...roles.map((role) => round.deathsByRole[role] ?? 0),
      ...roles.map((role) => round.shotsByRole[role] ?? 0),
      ...roles.map((role) => round.hitsByRole[role] ?? 0),
      ...roles.map((role) => (round.damageByRole[role] ?? 0).toFixed(1)),
      ...kinds.map((kind) => round.pickupsByKind[kind] ?? 0),
      round.weaponArchetypes.join(";"),
      ...archetypes.map((archetype) => round.killsByArchetype[archetype] ?? 0),
      ...TEMPO_COLUMNS.map((column) => round.tempo[column]),
      ...kinds.map((kind) => round.tempo.pickupWaitCount[kind] ?? 0),
      ...kinds.map((kind) => round.tempo.pickupWaitTicks[kind] ?? 0),
    ]);
  }
  return csv(rows);
}

/** One row per matchup. */
export function matchupsCsv(summary: BatchSummary): string {
  const rows: (string | number)[][] = [
    ["arena", "teamA", "teamB", "rounds", "wins", "losses", "draws", "winRate", "standardError"],
  ];
  for (const [key, value] of [...summary.byMatchup.entries()].sort()) {
    const [arena, teamA, teamB] = key.split("|");
    rows.push([
      arena ?? "",
      teamA ?? "",
      teamB ?? "",
      value.rounds,
      value.wins,
      value.losses,
      value.draws,
      winRate(value).toFixed(4),
      standardError(value).toFixed(4),
    ]);
  }
  return csv(rows);
}

/** One row per preset and arena, plus one row per preset over all arenas. */
export function presetsCsv(summary: BatchSummary): string {
  const rows: (string | number)[][] = [
    ["preset", "arena", "rounds", "wins", "losses", "draws", "winRate", "standardError"],
  ];
  const push = (preset: string, arena: string, value: WinRecord): void => {
    rows.push([
      preset,
      arena,
      value.rounds,
      value.wins,
      value.losses,
      value.draws,
      winRate(value).toFixed(4),
      standardError(value).toFixed(4),
    ]);
  };
  for (const preset of summary.presets) {
    for (const arena of summary.arenas) {
      const value = summary.byPresetArena.get(`${preset}|${arena}`);
      if (value) push(preset, arena, value);
    }
    const all = summary.byPreset.get(preset);
    if (all) push(preset, "(all)", all);
  }
  return csv(rows);
}
