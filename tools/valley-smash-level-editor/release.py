#!/usr/bin/env python3
"""Versions of the Valley Smash level editor, by the rules at the top of CHANGELOG.md.

    python release.py                  new entry from the commits since the last tag, embed it, commit, tag
    python release.py --dry-run        show the next version and its entry, change nothing
    python release.py --major "why"    a complete overhaul: next X
    python release.py embed            put CHANGELOG.md back into index.html (after a hand edit)
    python release.py check            exit 1 if the page and CHANGELOG.md differ

Then push with the tags: git push --follow-tags
"""
import argparse, datetime, io, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MD, HTML = os.path.join(HERE, "CHANGELOG.md"), os.path.join(HERE, "index.html")
TAG = "valley-smash-level-editor-v"
BEGIN, END = "<!--CHANGELOG:BEGIN-->", "<!--CHANGELOG:END-->"
SECTIONS = (("major", "Overhaul"), ("feature", "Features"), ("fix", "Fixes"))
RANK = {"none": 0, "fix": 1, "feature": 2, "major": 3}
SUBJECT_PREFIX = re.compile(r"^Valley Smash (level )?editor: ")


def git(*args):
    return subprocess.check_output(["git", "-C", HERE, *args], encoding="utf-8")


def read(path):
    with io.open(path, encoding="utf-8", newline="") as f:
        return f.read()


def write(path, text):
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def last_version():
    tags = git("tag", "--list", TAG + "*", "--sort=-v:refname").split()
    return tags[0][len(TAG):] if tags else None


def classify(subject, body):
    m = re.search(r"^Tool-Change:\s*(major|feature|fix|none)\s*$", body, re.I | re.M)
    if m:
        return m.group(1).lower()
    return "feature" if re.match(r"(add|adds|new)\b", SUBJECT_PREFIX.sub("", subject), re.I) else "fix"


def pending(version):
    span = [TAG + version + "..HEAD"] if version else []
    out = git("log", "--reverse", "--format=%h%x1f%s%x1f%b%x1e", *span, "--", ".")
    commits = []
    for rec in filter(str.strip, out.split("\x1e")):
        sha, subject, body = rec.strip().split("\x1f")
        commits.append({"sha": sha, "subject": subject, "level": classify(subject, body)})
    return [c for c in commits if c["level"] != "none"]


def bump(version, level):
    x, y, z = map(int, version.split("."))
    return {"major": f"{x + 1}.0.0", "feature": f"{x}.{y + 1}.0", "fix": f"{x}.{y}.{z + 1}"}[level]


def entry(version, commits, why=""):
    out = [f"## v{version} · {datetime.date.today().isoformat()}", ""]
    for level, title in SECTIONS:
        lines = [f"- {why}"] if why and level == "major" else []
        for c in commits:
            if c["level"] == level:
                text = SUBJECT_PREFIX.sub("", c["subject"])
                lines.append(f"- {text[:1].upper()}{text[1:]} `{c['sha']}`")
        if lines:
            out += [f"### {title}", "", *lines, ""]
    return "\n".join(out) + "\n"


def parsed():
    versions = []
    for line in read(MD).splitlines():
        m = re.match(r"## (v\d+\.\d+\.\d+) · (\S+)", line)
        if m:
            versions.append({"v": m.group(1), "date": m.group(2), "sections": []})
        elif versions and line.startswith("### "):
            versions[-1]["sections"].append({"title": line[4:].strip(), "items": []})
        elif versions and versions[-1]["sections"] and line.startswith("- "):
            versions[-1]["sections"][-1]["items"].append(re.sub(r"\s*`[0-9a-f]{7,}`\s*$", "", line[2:]))
    return versions


def block():
    data = json.dumps(parsed(), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return f'{BEGIN}<script type="application/json" id="changelogData">{data}</script>{END}'


def embedded(html):
    a, b = html.index(BEGIN), html.index(END) + len(END)
    return a, b


def embed():
    html = read(HTML)
    a, b = embedded(html)
    write(HTML, html[:a] + block() + html[b:])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", nargs="?", choices=("embed", "check"))
    ap.add_argument("--major", default="", metavar="WHY")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--trailer", default="", help="extra paragraph for the release commit message")
    args = ap.parse_args()

    if args.action == "embed":
        embed()
        print("embedded", parsed()[0]["v"])
        return 0
    if args.action == "check":
        html = read(HTML)
        a, b = embedded(html)
        same = html[a:b] == block()
        print("page and CHANGELOG.md match" if same else "page differs from CHANGELOG.md: python release.py embed")
        return 0 if same else 1

    version = last_version()
    if version is None:
        sys.exit("no tag " + TAG + "*: tag the version at the top of CHANGELOG.md first")
    commits = pending(version)
    if not commits and not args.major:
        print("nothing to release since v" + version)
        return 0
    level = "major" if args.major else max((c["level"] for c in commits), key=RANK.get)
    next_version = bump(version, level)
    text = entry(next_version, commits, args.major)
    if args.dry_run:
        print(text)
        return 0
    if git("status", "--porcelain", "--", ".").strip():
        sys.exit("this folder has uncommitted changes: commit them first")

    md = read(MD)
    first = md.index("## v")
    write(MD, md[:first] + text + "\n" + md[first:])
    embed()
    msg = ["-m", f"Valley Smash editor: release v{next_version}", "-m", "Tool-Change: none"]
    if args.trailer:
        msg += ["-m", args.trailer]
    git("commit", *msg, "--", "CHANGELOG.md", "index.html")
    git("tag", "-a", TAG + next_version, "-m", f"Valley Smash level editor v{next_version}")
    print(f"released v{next_version}; push with: git push --follow-tags")
    return 0


if __name__ == "__main__":
    sys.exit(main())
