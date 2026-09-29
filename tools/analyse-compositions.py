"""Read a composition sweep and say what it found. No simulation runs here."""
import csv, collections, math, sys

ORDER = ["3T","2T1S","1T2S","3S","1T1O1S","2T1O","1O2S","1T2O","2O1S","3O"]

def load(path):
    return list(csv.DictReader(open(path)))

def score(row, side):
    if row["winner"] == "draw": return 0.5
    return 1.0 if row["winner"] == side else 0.0

def se(rate, n):
    return math.sqrt(max(0.0, rate * (1 - rate)) / max(1, n)) * 100

def composition_rates(rows):
    tally = collections.defaultdict(lambda: [0.0, 0])
    for r in rows:
        for side, comp in (("A", r["compA"]), ("B", r["compB"])):
            tally[comp][0] += score(r, side)
            tally[comp][1] += 1
    return {c: (w / n, n) for c, (w, n) in tally.items()}

def overwatch_count(comp):
    """How many overwatch a composition name carries, e.g. 2O1S -> 2."""
    i = comp.find("O")
    return int(comp[i - 1]) if i > 0 else 0

def mirror_side_bias(rows):
    """Team A's win rate where both teams play the SAME composition.

    With the composition held equal, anything away from 50 % is the side and
    nothing else. It is the cleanest side-bias instrument this batch holds.
    """
    tally = collections.defaultdict(lambda: [0.0, 0])
    for r in rows:
        if r["compA"] != r["compB"]:
            continue
        tally[r["compA"]][0] += score(r, "A")
        tally[r["compA"]][1] += 1
    return {c: (w / n, n) for c, (w, n) in tally.items()}

def num(r, k):
    try: return float(r[k] or 0)
    except (KeyError, ValueError): return 0.0

def tempo(rows):
    kills = sum(num(r,"scoreA") + num(r,"scoreB") for r in rows)
    c = sum(num(r,"killsClose") for r in rows)
    m = sum(num(r,"killsMid") for r in rows)
    l = sum(num(r,"killsLong") for r in rows)
    tot = max(1.0, c + m + l)
    alive = max(1.0, sum(num(r,"aliveTicksSum") for r in rows))
    gaps = max(1.0, sum(num(r,"killGaps") for r in rows))
    return {
        "n": len(rows),
        "ticks": sum(num(r,"ticks") for r in rows) / max(1, len(rows)),
        "kills": kills / max(1, len(rows)),
        "close": c / tot * 100, "mid": m / tot * 100, "long": l / tot * 100,
        "contact": sum(num(r,"contactTicksSum") for r in rows) / alive * 100,
        "gap": sum(num(r,"killGapSum") for r in rows) / gaps / 20,
    }

# A leading --dir names one more output folder to look in, so a new batch does
# not need a new name here.
argv = sys.argv[1:]
extra = []
while argv and argv[0] == "--dir":
    extra.append(argv[1])
    argv = argv[2:]
styles = argv
data = {}
for style in styles:
    for path in ([f"{d}/rounds-{style}.csv" for d in extra] +
                 [f"batch-out/roles/rounds-{style}.csv",
                  f"batch-out/roles-{style}/rounds-{style}.csv"]):
        try:
            data[style] = load(path)
            break
        except FileNotFoundError:
            continue

print("COMPOSITION WIN RATE, per style (%, +- one standard error)")
print(f"{'comp':9}" + "".join(f"{s:>18}" for s in styles))
for comp in ORDER:
    line = f"{comp:9}"
    for style in styles:
        rate, n = composition_rates(data[style]).get(comp, (0, 0))
        line += f"{rate*100:>12.1f} ±{se(rate,n):<4.1f}"
    print(line)

print("\nBY OVERWATCH COUNT (%)")
print(f"{'overwatch':9}" + "".join(f"{s:>18}" for s in styles))
for k in range(4):
    line = f"{k:<9}"
    for style in styles:
        rates = composition_rates(data[style])
        w = sum(r * n for c, (r, n) in rates.items() if overwatch_count(c) == k)
        t = sum(n for c, (r, n) in rates.items() if overwatch_count(c) == k)
        rate = w / max(1, t)
        line += f"{rate*100:>12.1f} ±{se(rate,t):<4.1f}"
    print(line)

print("\nSIDE BIAS: team A win rate where BOTH teams play the same composition")
print("(the composition is held equal, so anything away from 50 % is the side)")
print(f"{'comp':9}" + "".join(f"{s:>18}" for s in styles))
for comp in ORDER:
    line = f"{comp:9}"
    for style in styles:
        rate, n = mirror_side_bias(data[style]).get(comp, (0, 0))
        line += f"{rate*100:>12.1f} ±{se(rate,n):<4.1f}"
    print(line)
line = f"{'POOLED':9}"
for style in styles:
    m = mirror_side_bias(data[style])
    w = sum(r * n for r, n in m.values()); t = sum(n for _, n in m.values())
    rate = w / max(1, t)
    line += f"{rate*100:>12.1f} ±{se(rate,t):<4.1f}"
print(line)
line = f"{'ALL':9}"
for style in styles:
    rows = data[style]
    rate = sum(score(r, "A") for r in rows) / max(1, len(rows))
    line += f"{rate*100:>12.1f} ±{se(rate,len(rows)):<4.1f}"
print(line + "   (every round, both sides)")

print("\nTHE FIGHT, by style")
print(f"{'style':11}{'ticks':>7}{'kills':>7}{'close':>8}{'mid':>7}{'long':>7}{'contact':>9}{'kill gap':>10}")
for style in styles:
    t = tempo(data[style])
    print(f"{style:11}{t['ticks']:>7.0f}{t['kills']:>7.1f}{t['close']:>7.0f}%{t['mid']:>6.0f}%"
          f"{t['long']:>6.0f}%{t['contact']:>8.0f}%{t['gap']:>9.1f}s")

print("\nTEMPO OF A MIRROR MATCHUP, by composition and style")
for style in styles:
    print(f"  {style}")
    print(f"    {'comp':9}{'ticks':>7}{'kills':>7}{'close':>8}{'mid':>7}{'long':>7}{'contact':>9}")
    for comp in ["3T", "3S", "1T1O1S", "3O"]:
        rows = [r for r in data[style] if r["compA"] == comp and r["compB"] == comp]
        if not rows: continue
        t = tempo(rows)
        print(f"    {comp:9}{t['ticks']:>7.0f}{t['kills']:>7.1f}{t['close']:>7.0f}%"
              f"{t['mid']:>6.0f}%{t['long']:>6.0f}%{t['contact']:>8.0f}%")
