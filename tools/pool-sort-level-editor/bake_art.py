"""Bake Pool Sort art and layout from the team's Unity project into the level editor page.

Reads YAML prefabs, the mechanic catalogue and PNG sprites straight from disk (no Unity), and rewrites only the
region between <!--ART:BEGIN--> and <!--ART:END--> in index.html with  window.ART = {...};

Usage:  python bake_art.py [--repo <fish-sort-puzzle>] [--html index.html] [--check]
The repo defaults to <brain>/01-projects/pool-sort/fish-sort-puzzle, found by walking up from this folder.
"""
import argparse
import base64
import datetime
import glob
import io
import json
import os
import re
import subprocess
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TOY = 'Assets/_Game/ToySort'
FSP = 'Assets/_BaseCode/Image/_FSP'
# FloatieMechanicType values used as catalogue keys (ToySort.Core.MechanicTypes)
SKIN_TYPES = {1: 'frozen', 2: 'hidden', 3: 'lock', 8: 'net', 9: 'obstacle2'}
MAX_PX = {'toy': 192, 'body': 384, 'overlay': 384, 'ui': 160}
GUID = r'\{fileID: -?\d+, guid: ([0-9a-f]{32})'


def find_repo():
    d = HERE
    for _ in range(10):
        p = os.path.join(d, '01-projects', 'pool-sort', 'fish-sort-puzzle')
        if os.path.isdir(p):
            return p
        d = os.path.dirname(d)
    sys.exit('fish-sort-puzzle not found; pass --repo')


class Repo:
    def __init__(self, root):
        self.root = root
        self.guid = {}
        for sub in (TOY, FSP):
            for meta in glob.glob(os.path.join(root, sub, '**', '*.meta'), recursive=True):
                with open(meta, encoding='utf-8', errors='ignore') as f:
                    m = re.search(r'guid: ([0-9a-f]{32})', f.read())
                if m:
                    self.guid[m.group(1)] = meta[:-5]

    def path(self, rel):
        return os.path.join(self.root, rel)

    def ppu(self, png):
        with open(png + '.meta', encoding='utf-8', errors='ignore') as f:
            m = re.search(r'spritePixelsToUnits: ([\d.]+)', f.read())
        return float(m.group(1)) if m else 100.0


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def docs(path):
    """Unity YAML -> {fileID: (classID, body)}."""
    parts = re.split(r'\n--- !u!(\d+) &(-?\d+)[^\n]*', read(path))
    return {parts[i + 1]: (parts[i], parts[i + 2]) for i in range(1, len(parts), 3)}


def vec(body, key):
    m = re.search(key + r': \{x: ([^,]+), y: ([^,]+)', body)
    return (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)


class Prefab:
    """Transforms (2D: position + uniform scale, no rotation) and sprite renderers by GameObject name."""

    def __init__(self, path, repo):
        self.d = docs(path)
        names = {fid: re.search(r'm_Name: (.*)', b).group(1).strip() for fid, (c, b) in self.d.items() if c == '1'}
        self.tr = {}  # transform fileID -> dict(name, pos, scale, parent)
        for fid, (c, b) in self.d.items():
            if c in ('4', '224') and 'm_GameObject' in b:
                go = re.search(r'm_GameObject: \{fileID: (-?\d+)', b).group(1)
                parent = re.search(r'm_Father: \{fileID: (-?\d+)', b)
                self.tr[fid] = dict(name=names.get(go, '?'), pos=vec(b, 'm_LocalPosition'),
                                    scale=vec(b, 'm_LocalScale')[0], parent=parent.group(1) if parent else '0')
        self.sprites = {}  # GameObject name -> png path
        for c, b in self.d.values():
            if c == '212':
                go = re.search(r'm_GameObject: \{fileID: (-?\d+)', b).group(1)
                g = re.search(r'm_Sprite: ' + GUID, b)
                if g and g.group(1) in repo.guid:
                    self.sprites[names.get(go, '?')] = repo.guid[g.group(1)]
        self.instances = []  # nested prefab instances (the float slots): name, pose, parent transform
        for c, b in self.d.values():
            if c == '1001':
                mods = dict(re.findall(r'propertyPath: (m_LocalPosition\.[xy]|m_LocalScale\.x|m_Name)\n\s+value: ([^\n]*)', b))
                parent = re.search(r'm_TransformParent: \{fileID: (-?\d+)', b)
                self.instances.append(dict(
                    name=mods.get('m_Name', '?').strip(),
                    pos=(float(mods.get('m_LocalPosition.x', 0)), float(mods.get('m_LocalPosition.y', 0))),
                    scale=float(mods.get('m_LocalScale.x', 1)), parent=parent.group(1) if parent else '0'))

    def root(self):
        return next(t for t in self.tr.values() if t['parent'] == '0')

    def has(self, name):
        return any(t['name'] == name for t in self.tr.values())

    def world(self, fid, pos=(0.0, 0.0), scale=1.0):
        """Compose a pose up the parent chain into the root's space; the root's own pose is left out."""
        x, y, s = pos[0], pos[1], scale
        while fid in self.tr and self.tr[fid]['parent'] != '0':
            t = self.tr[fid]
            x, y, s = t['pos'][0] + t['scale'] * x, t['pos'][1] + t['scale'] * y, t['scale'] * s
            fid = t['parent']
        return x, y, s

    def node(self, name):
        """Pose of the first transform with this name, in root space (x, y, scale)."""
        fid = next(f for f, t in self.tr.items() if t['name'] == name and t['parent'] != '0')
        t = self.tr[fid]
        return self.world(t['parent'], t['pos'], t['scale'])

    def circle_radius(self):
        for c, b in self.d.values():
            if c == '58':
                return float(re.search(r'm_Radius: ([\d.]+)', b).group(1))
        return None


class Images:
    def __init__(self, repo):
        self.repo, self.out = repo, {}

    def add(self, name, png, kind):
        if name not in self.out:
            im = Image.open(png).convert('RGBA')
            w, h = im.size
            im.thumbnail((MAX_PX[kind], MAX_PX[kind]), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, 'WEBP', quality=88, method=6)
            self.out[name] = dict(src='data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode(),
                                  w=w, h=h, ppu=self.repo.ppu(png))
        return name


def bake(repo_root):
    repo = Repo(repo_root)
    imgs = Images(repo)
    layout_cs = read(repo.path(TOY + '/Scripts/Runtime/Config/ToySortLayout.cs'))
    art_radius = float(re.search(r'FloatieArtRadius = ([\d.]+)f', layout_cs).group(1))
    obstacle_scales = [float(x) for x in re.findall(r'([\d.]+)f', re.search(r'ObstacleScales = \{([^}]*)\}', layout_cs).group(1))]

    floats = {}
    for n in range(1, 6):
        p = Prefab(repo.path(f'{TOY}/Prefabs/Floatie_{n}.prefab'), repo)
        bx, by, bs = p.node('Visual')
        slots = []
        for inst in sorted((i for i in p.instances if i['name'].startswith('Slot_')), key=lambda i: int(i['name'][5:])):
            x, y, _s = p.world(inst['parent'], inst['pos'], inst['scale'])
            slots.append([round(x, 4), round(y, 4)])
        floats[str(n)] = dict(radius=p.circle_radius(), slots=slots,
                              body=dict(img=imgs.add('float', p.sprites['Visual'], 'body'), x=bx, y=by, s=bs))
    ob = Prefab(repo.path(f'{TOY}/Prefabs/Floatie_Obstacle.prefab'), repo)
    x, y, s = ob.node('Visual')
    stone = dict(radius=ob.circle_radius(), body=dict(img=imgs.add('stone', ob.sprites['Visual'], 'body'), x=x, y=y, s=s))

    # Item size: FloatieView sets the Toy root's scale to the board's floatie toy scale (ToySettings.Scale);
    # the sprite child keeps its own scale under it.
    board = read(repo.path(f'{TOY}/Prefabs/ToySortBoardView.prefab'))
    toy_settings = float(re.search(r'floatieToy:\s*\n\s*Scale: ([\d.]+)', board).group(1))
    toy = Prefab(repo.path(f'{TOY}/Prefabs/Toy.prefab'), repo)
    sprite_scale = toy.node('Toy')[2] if toy.has('Toy') and any(
        t['name'] == 'Toy' and t['parent'] != '0' for t in toy.tr.values()) else 1.0
    toy_scale = toy_settings * sprite_scale
    ice_scale = toy.node('Ice')[2] / sprite_scale  # relative to the item sprite

    cat = read(repo.path(f'{TOY}/Configs/MechanicVisualCatalog.asset'))
    overlays = {}

    def overlay(key, prefab_path):
        p = Prefab(prefab_path, repo)
        x, y, s = p.node('Skin')  # Spine-driven skins keep a static sprite on Skin; use it
        rs = p.root()['scale']
        counter = p.node('Counter') if p.has('Counter') else None
        overlays[key] = dict(img=imgs.add('ov_' + key, p.sprites['Skin'], 'overlay'), x=x * rs, y=y * rs, s=s * rs,
                             counter=[counter[0] * rs, counter[1] * rs] if counter else None)

    for t, g in re.findall(r'- type: (\d+)\n\s+prefab: ' + GUID, cat):
        if int(t) in SKIN_TYPES:
            overlay(SKIN_TYPES[int(t)], repo.guid[g])
    overlay('key', repo.guid[re.search(r'keyCarrierBadge: ' + GUID, cat).group(1)])
    overlay('portal', repo.guid[re.search(r'portalBadge: ' + GUID, cat).group(1)])
    link = Prefab(repo.guid[re.search(r'linkChain: ' + GUID, cat).group(1)], repo)
    link_png = next(iter(link.sprites.values()))
    mystery_png = repo.guid[re.search(r'unknownToy: ' + GUID, cat).group(1)]

    toys = sorted(int(re.search(r'toy_(\d+)\.png$', p).group(1))
                  for p in glob.glob(repo.path(f'{TOY}/Resources/ToySort/Toy/toy_*.png')))
    for i in toys:
        imgs.add(f'toy_{i}', repo.path(f'{TOY}/Resources/ToySort/Toy/toy_{i}.png'), 'toy')
    ui = {k: imgs.add(k, repo.path(f'{FSP}/{rel}'), 'ui') for k, rel in [
        ('tray', 'Gameplay/Tray.png'), ('clock', 'Mechanic/i_time.png'), ('timeFrame', 'Mechanic/Time_fr.png'),
        ('hard', 'level difficulty/i_Warning_hard.png'), ('superhard', 'level difficulty/i_Warning_sphard.png')]}
    commit = subprocess.run(['git', '-C', repo_root, 'rev-parse', '--short', 'HEAD'],
                            capture_output=True, text=True).stdout.strip()
    return dict(generated=datetime.datetime.now().isoformat(timespec='seconds'), repoCommit=commit,
                floatArtRadius=art_radius, toyScale=round(toy_scale, 5), iceScale=round(ice_scale, 5),
                obstacleScales=obstacle_scales, floats=floats, stone=stone, overlays=overlays,
                toyArt=dict(ice=imgs.add('toy_ice', toy.sprites['Ice'], 'toy'),
                            mystery=imgs.add('mystery', mystery_png, 'toy'), link=imgs.add('link', link_png, 'toy')),
                ui=ui, toys=toys, images=imgs.out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default=None)
    ap.add_argument('--html', default=os.path.join(HERE, 'index.html'))
    ap.add_argument('--check', action='store_true', help='print the manifest summary, write nothing')
    a = ap.parse_args()
    art = bake(a.repo or find_repo())
    payload = json.dumps(art, separators=(',', ':'))
    summary = {k: v for k, v in art.items() if k != 'images'}
    print(json.dumps(summary, indent=1))
    print(f'{len(art["images"])} images, {len(payload) / 1024:.0f} KB')
    if a.check:
        return
    html = read(a.html)
    new, n = re.subn(r'<!--ART:BEGIN-->.*?<!--ART:END-->',
                     lambda _m: '<!--ART:BEGIN-->\n<script>window.ART = ' + payload + ';</script>\n<!--ART:END-->',
                     html, flags=re.S)
    if n != 1:
        sys.exit('ART markers not found exactly once')
    with open(a.html, 'w', encoding='utf-8', newline='\n') as f:
        f.write(new)
    print('wrote', a.html)


if __name__ == '__main__':
    main()
