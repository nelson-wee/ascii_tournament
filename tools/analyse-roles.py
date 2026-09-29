"""Per-role production from a batch, across styles (dev-guide Section 7.39).

Kills and deaths say how a role finished a round. Shots, hits and damage say how
it spent one, and the four apart say whether a role is unproductive, inaccurate,
or merely unrewarded.

    python3 tools/analyse-roles.py --dir batch-out/roles-all bastion cavern openfield
"""
import csv, collections, math, sys

ROLES = ["tank", "skirmisher", "overwatch"]
LETTER = {"T": "tank", "S": "skirmisher", "O": "overwatch"}


def load(path):
    return list(csv.DictReader(open(path)))


def seats_of(comp):
    """How many seats each role takes in a composition name such as 2T1O."""
    out = collections.Counter()
    i = 0
    while i < len(comp):
        out[LETTER[comp[i + 1]]] += int(comp[i])
        i += 2
    return out


def tally(rows):
    sums = {key: collections.Counter() for key in ("kills", "deaths", "shots", "hits", "damage")}
    seats = collections.Counter()
    for row in rows:
        for role in ROLES:
            sums["kills"][role] += int(row[f"kills_role_{role}"])
            sums["deaths"][role] += int(row[f"deaths_role_{role}"])
            sums["shots"][role] += int(row[f"shots_role_{role}"])
            sums["hits"][role] += int(row[f"hits_role_{role}"])
            sums["damage"][role] += float(row[f"damage_role_{role}"])
        for comp in (row["compA"], row["compB"]):
            seats.update(seats_of(comp))
    return sums, seats


def rates(sums, seats, role):
    seat = max(1, seats[role])
    shots = max(1, sums["shots"][role])
    hits = max(1, sums["hits"][role])
    kills = max(1, sums["kills"][role])
    return {
        "shots/seat": sums["shots"][role] / seat,
        "landed/shot": sums["hits"][role] / shots,
        "damage/seat": sums["damage"][role] / seat,
        "damage/hit": sums["damage"][role] / hits,
        "kills/seat": sums["kills"][role] / seat,
        "damage/kill": sums["damage"][role] / kills,
        "K/D": sums["kills"][role] / max(1, sums["deaths"][role]),
    }


COLUMNS = ["shots/seat", "landed/shot", "damage/seat", "damage/hit", "kills/seat", "damage/kill", "K/D"]

argv = sys.argv[1:]
extra = []
while argv and argv[0] == "--dir":
    extra.append(argv[1])
    argv = argv[2:]
styles = argv

data = {}
for style in styles:
    for path in [f"{d}/rounds-{style}.csv" for d in extra] + [
        f"batch-out/roles/rounds-{style}.csv",
        f"batch-out/roles-{style}/rounds-{style}.csv",
    ]:
        try:
            data[style] = load(path)
            break
        except FileNotFoundError:
            continue

print("PER-ROLE PRODUCTION, by style")
for style in styles:
    rows = data.get(style)
    if rows is None:
        print(f"\n{style}: no rounds file found")
        continue
    sums, seats = tally(rows)
    print(f"\n  {style}  ({len(rows)} rounds, seats {dict(seats)})")
    print("    " + "role".ljust(11) + "".join(c.rjust(13) for c in COLUMNS))
    for role in ROLES:
        r = rates(sums, seats, role)
        print("    " + role.ljust(11) + "".join(f"{r[c]:13.3f}" for c in COLUMNS))
    base = rates(sums, seats, "tank")
    over = rates(sums, seats, "overwatch")
    print("    " + "over/tank".ljust(11) + "".join(
        f"{(over[c] / base[c] if base[c] else 0):13.2f}" for c in COLUMNS))

print("\nTHE DECOMPOSITION: Overwatch damage a seat, against Tank")
print(f"{'style':11}{'shots/seat':>12}{'landed/shot':>13}{'damage/hit':>12}{'product':>10}{'measured':>10}")
for style in styles:
    rows = data.get(style)
    if rows is None:
        continue
    sums, seats = tally(rows)
    t, o = rates(sums, seats, "tank"), rates(sums, seats, "overwatch")
    parts = [o["shots/seat"] / t["shots/seat"], o["landed/shot"] / t["landed/shot"], o["damage/hit"] / t["damage/hit"]]
    product = parts[0] * parts[1] * parts[2]
    print(f"{style:11}{parts[0]:12.2f}{parts[1]:13.2f}{parts[2]:12.2f}{product:10.2f}"
          f"{o['damage/seat'] / t['damage/seat']:10.2f}")

print("\nDOES OVERWATCH HOLD A MARKSMAN? kills a round by the overwatch seats a round")
print(f"{'style':11}{'0 seats':>10}{'1':>8}{'2':>8}{'3':>8}{'4':>8}{'5':>8}{'6':>8}")
for style in styles:
    rows = data.get(style)
    if rows is None:
        continue
    by = collections.defaultdict(lambda: [0.0, 0])
    for row in rows:
        n = seats_of(row["compA"])["overwatch"] + seats_of(row["compB"])["overwatch"]
        by[n][0] += int(row["kills_marksman"])
        by[n][1] += 1
    line = f"{style:11}"
    for n in range(7):
        total, count = by.get(n, (0.0, 0))
        line += (f"{total / count:8.2f}" if count else f"{'-':>8}")
    print(line)
