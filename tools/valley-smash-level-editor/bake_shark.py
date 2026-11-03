# -*- coding: utf-8 -*-
"""
Bakes the Shark Box (id 260, section Creative) into art/ without Unity, then run inline_art.py.

The Unity exporter cannot draw this block: its mouths are four Spine skeletons (SkeletonAnimation),
which the exporter strips, so it would bake a plain blue box. This script reads the team repo's files
with `git show`: the real mesh (sharp_box.fbx), the real BaseColor texture, and the tutorial icon
shark_block_icon.png, which stands in for the Spine face.
  Texture: left half = BaseColor (top, bottom), right half = the face (the four sides).
  Sprites: a small software render, framed like the exporter's (ortho 1.24 units, iso from ISO_DIR).

Run it again after every full Export Art, which rewrites art/manifest.json:
    python bake_shark.py [--repo <block-shot-2>] [--ref <branch or commit>]
    python inline_art.py
"""
import os, io, json, struct, zlib, argparse, subprocess
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, "art")
ID, PREFAB, MESH, TEX = "260", "Shark_Box", "sharp_box", "Shark_Box_faces"
FBX_SCALE = 0.086                       # globalScale in sharp_box.fbx.meta
SRC = {
    "fbx": "Assets/001.MATTerial/000.Objects_Ingame/Creative/sharp_box/sharp_box.fbx",
    "base": "Assets/001.MATTerial/000.Objects_Ingame/Creative/sharp_box/OBS_sharp_box_BaseColor.png",
    "icon": "Assets/_BaseCode/Image Using/Tutorial/shark_block_icon.png",
}
# BS___Sharp_box.mat, in the shape of the exporter's ShadeJson. model mk: same shader as TNT.
SHADE = {"model": "mk", "bands": 4, "bandScale": 0.5, "contrast": 1.05, "brightness": 1, "spec": "#0c0c0c",
         "smooth": 0.538, "rim": "#cccccc", "rimAmount": 0, "tint": "#ffffff"}
LIGHT_FWD = np.array([-0.2597, -0.3536, 0.8986])  # LIGHT_EULER as a Unity forward vector
SIDE_BG = (44, 150, 244, 255)           # the BaseColor's side blue, behind the icon's rounded corners
ICON_SIZE, VIEW_SIZE, ORTHO = 128, 96, 1.24
ISO_DIR, ISO_DIST, ISO_FOV = np.array([0.62, 0.45, -1.0]), 3.05, 30.0


def git_show(repo, ref, path):
    return subprocess.run(["git", "-C", repo, "show", ref + ":" + path], check=True, capture_output=True).stdout


def fbx_geometry(b):
    """Binary FBX 7.5+: returns vertices, polygon indices, normals by vertex, UV and UV index."""
    def node(p):
        end, count, _ = struct.unpack("<QQQ", b[p:p + 24]); p += 24
        n = b[p]; name = b[p + 1:p + 1 + n].decode(); p += 1 + n
        if end == 0:
            return None, p
        props = []
        for _ in range(count):
            t = chr(b[p]); p += 1
            if t in "fdli":
                length, enc, size = struct.unpack("<III", b[p:p + 12]); p += 12
                raw = b[p:p + size]; p += size
                if enc == 1:
                    raw = zlib.decompress(raw)
                props.append(np.frombuffer(raw, {"f": "<f4", "d": "<f8", "l": "<i8", "i": "<i4"}[t], length))
            elif t in "SR":
                size = struct.unpack("<I", b[p:p + 4])[0]; p += 4
                props.append(b[p:p + size]); p += size
            else:
                size = {"Y": 2, "C": 1, "I": 4, "F": 4, "D": 8, "L": 8}[t]
                props.append(b[p:p + size]); p += size
        kids = []
        while p < end:
            k, p = node(p)
            if k is None:
                break
            kids.append(k)
        return {"name": name, "props": props, "kids": kids}, end

    p = 27
    while True:
        top, p = node(p)
        if top["name"] == "Objects":
            break
    geo = next(k for k in top["kids"] if k["name"] == "Geometry")
    g = {k["name"]: k for k in geo["kids"]}
    arr = lambda parent, name: next(k for k in parent["kids"] if k["name"] == name)["props"][0]
    return (arr(geo, "Vertices").reshape(-1, 3), arr(geo, "PolygonVertexIndex"),
            arr(g["LayerElementNormal"], "Normals").reshape(-1, 3),
            arr(g["LayerElementUV"], "UV").reshape(-1, 2), arr(g["LayerElementUV"], "UVIndex"))


def build_mesh(fbx):
    """Unity space (x flipped, scaled). Polygons facing a side get flat UVs into the face half."""
    verts, pvi, normals, uvs, uvi = fbx_geometry(fbx)
    verts = verts * FBX_SCALE * np.array([-1, 1, 1])
    normals = normals * np.array([-1, 1, 1])
    half = float(np.abs(verts).max())
    pos, nor, uv, idx, poly, c = [], [], [], [], [], 0
    for i, v in enumerate(pvi):
        poly.append((int(v) if v >= 0 else int(~v), c)); c += 1
        if v >= 0:
            continue
        n = sum(normals[a] for a, _ in poly)
        ax = int(np.argmax(np.abs(n)))
        base = len(pos)
        for a, corner in poly:
            x, y, z = verts[a]
            if ax == 1:
                u, w = uvs[uvi[corner]]
                u, w = u * 0.5, w
            else:                       # right = +x on -z, +z on +x, -x on +z, -z on -x, seen from outside
                h = {(2, -1): x, (0, 1): z, (2, 1): -x, (0, -1): -z}[(ax, 1 if n[ax] > 0 else -1)]
                u = 0.5 + 0.5 * np.clip((h + half) / (2 * half), 0.005, 0.995)
                w = np.clip((y + half) / (2 * half), 0.005, 0.995)
            pos.append(verts[a]); nor.append(normals[a]); uv.append((u, w))
        for k in range(1, len(poly) - 1):
            tri = [base, base + k, base + k + 1]
            a, b, cc = (np.array(pos[t]) for t in tri)
            # stored winding of the exporter's meshes: cross(b-a, c-a) along the normal
            if np.dot(np.cross(b - a, cc - a), nor[base]) < 0:
                tri = [tri[0], tri[2], tri[1]]
            idx += tri
        poly = []
    return np.array(pos), np.array(nor), np.array(uv), np.array(idx), half


def build_texture(base_png, icon_png):
    base = Image.open(io.BytesIO(base_png)).convert("RGBA").resize((512, 512), Image.LANCZOS)
    icon = Image.open(io.BytesIO(icon_png)).convert("RGBA")
    icon = icon.crop(icon.getbbox()).resize((512, 512), Image.LANCZOS)
    face = Image.new("RGBA", (512, 512), SIDE_BG)
    face.alpha_composite(icon)
    atlas = Image.new("RGBA", (1024, 512))
    atlas.paste(base, (0, 0)); atlas.paste(face, (512, 0))
    return atlas


def render(pos, nor, uv, idx, tex, size, cam, right, up, ortho=None, fov=None):
    """z-buffered triangles at 4x, downsampled; toon light close to the exporter's sprites."""
    ss = size * 4
    img = np.zeros((ss, ss, 4), np.float32)
    zb = np.full((ss, ss), np.inf, np.float32)
    atlas = np.asarray(tex.convert("RGB"), np.float32)
    H, W = atlas.shape[:2]
    fwd = -cam / np.linalg.norm(cam)
    rel = pos - (cam if fov else 0)
    vx, vy, depth = rel @ right, rel @ up, rel @ fwd
    if fov:
        f = 1 / np.tan(np.radians(fov) / 2) * ss / 2
        sx, sy = ss / 2 + f * vx / depth, ss / 2 - f * vy / depth
    else:
        sx, sy = ss / 2 + vx / ortho * ss, ss / 2 - vy / ortho * ss
    for t in idx.reshape(-1, 3):
        x, y = sx[t], sy[t]
        d = (y[1] - y[2]) * (x[0] - x[2]) + (x[2] - x[1]) * (y[0] - y[2])
        if abs(d) < 1e-6:
            continue
        x0, x1 = max(int(x.min()), 0), min(int(x.max()) + 1, ss - 1)
        y0, y1 = max(int(y.min()), 0), min(int(y.max()) + 1, ss - 1)
        if x0 > x1 or y0 > y1:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
        a = ((y[1] - y[2]) * (gx - x[2]) + (x[2] - x[1]) * (gy - y[2])) / d
        b = ((y[2] - y[0]) * (gx - x[2]) + (x[0] - x[2]) * (gy - y[2])) / d
        c = 1 - a - b
        m = (a >= 0) & (b >= 0) & (c >= 0)
        z = a * depth[t[0]] + b * depth[t[1]] + c * depth[t[2]]
        m &= z < zb[y0:y1 + 1, x0:x1 + 1]
        if not m.any():
            continue
        zb[y0:y1 + 1, x0:x1 + 1][m] = z[m]
        u = a * uv[t[0], 0] + b * uv[t[1], 0] + c * uv[t[2], 0]
        v = a * uv[t[0], 1] + b * uv[t[1], 1] + c * uv[t[2], 1]
        col = atlas[np.clip(((1 - v) * H).astype(int), 0, H - 1), np.clip((u * W).astype(int), 0, W - 1)]
        n = a[..., None] * nor[t[0]] + b[..., None] * nor[t[1]] + c[..., None] * nor[t[2]]
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        lit = np.clip(n @ -LIGHT_FWD, 0, 1)
        lit = 0.72 + 0.34 * np.floor(lit * 4 + .5) / 4
        rgb = np.clip(col * lit[..., None], 0, 255)
        img[y0:y1 + 1, x0:x1 + 1][m] = np.dstack([rgb, np.full(rgb.shape[:2], 255.)])[m]
    im = Image.fromarray(img.astype(np.uint8), "RGBA")
    return im.resize((size, size), Image.BOX)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=os.path.join(HERE, "..", "..", "..", "..", "valley-smash", "block-shot-2"))
    ap.add_argument("--ref", default="origin/Creative/RemakeOBSMultilevelObstacle")
    args = ap.parse_args()
    src = {k: git_show(args.repo, args.ref, p) for k, p in SRC.items()}

    pos, nor, uv, idx, half = build_mesh(src["fbx"])
    tex = build_texture(src["base"], src["icon"])

    tex.save(os.path.join(ART, "textures", TEX + ".png"))
    with open(os.path.join(ART, "meshes", MESH + ".json"), "w", encoding="utf8") as f:
        json.dump({"name": MESH, "position": [round(float(x), 5) for x in pos.ravel()],
                   "normal": [round(float(x), 5) for x in nor.ravel()],
                   "uv": [round(float(x), 5) for x in uv.ravel()], "index": [int(i) for i in idx],
                   "center": [0, 0, 0], "size": [round(2 * half, 4)] * 3}, f)

    X, Y, Z = np.array([1., 0, 0]), np.array([0., 1, 0]), np.array([0., 0, 1])
    views = {"front": (-Z, X, Y), "side": (X, Z, Y), "top": (Y, X, Z)}
    entry = {"prefab": PREFAB, "mesh": MESH, "tex": TEX, "shade": SHADE, "mass": 5}
    for view, (cam, right, up) in views.items():
        entry[view] = "icons/%s__%s.png" % (PREFAB, view)
        render(pos, nor, uv, idx, tex, VIEW_SIZE, cam, right, up, ortho=ORTHO).save(os.path.join(ART, entry[view]))
    cam = ISO_DIR / np.linalg.norm(ISO_DIR) * ISO_DIST
    right = np.cross(Y, -cam); right /= np.linalg.norm(right)
    up = np.cross(-cam, right); up /= np.linalg.norm(up)
    entry["iso"] = "icons/%s__iso.png" % PREFAB
    render(pos, nor, uv, idx, tex, ICON_SIZE, cam, right, up, fov=ISO_FOV).save(os.path.join(ART, entry["iso"]))

    man_path = os.path.join(ART, "manifest.json")
    with open(man_path, encoding="utf8") as f:
        man = json.load(f)
    man["icons"]["vs"][ID] = entry
    man["meshes"][MESH] = "meshes/%s.json" % MESH
    man["textures"][TEX] = "textures/%s.png" % TEX
    with open(man_path, "w", encoding="utf8") as f:
        json.dump(man, f, ensure_ascii=False)
    print("Shark Box baked: %d triangles, half size %.4f. Next: python inline_art.py" % (len(idx) // 3, half))


if __name__ == "__main__":
    main()
