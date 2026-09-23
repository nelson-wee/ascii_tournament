/**
 * The terminal tables and the CSV files of the batch harness
 * (dev-guide Section 7.16).
 */
import type { RoundRecord, BatchSummary, WinRecord } from "./batchStats.js";
import { standardError, winRate } from "./batchStats.js";

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

/** One row per round. */
export function roundsCsv(records: readonly RoundRecord[]): string {
  const archetypes = [
    ...new Set(records.flatMap((round) => Object.keys(round.killsByArchetype))),
  ].sort();
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
      ...archetypes.map((archetype) => `kills_${archetype}`),
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
      ...archetypes.map((archetype) => round.killsByArchetype[archetype] ?? 0),
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
