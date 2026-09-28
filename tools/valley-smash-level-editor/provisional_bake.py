# -*- coding: utf-8 -*-
"""
Bake TAM cho bang mau cua level editor - KHONG can mo Unity.

Muc dich: co ngay icon dung MAU THAT lay tu anh albedo cua game, va thu nho san
bo texture de khung 3D dung o giai doan 2. Khi ban chay
    Unity  ->  Tools / Level Editor / Export Art
thi icon o day se bi GHI DE bang anh render that cua Unity (dung shader MK Toon,
dung den cua game). Moi icon o day deu duoc danh dau  "provisional": true
trong manifest de phan biet.

Chay:  python tools/valley-smash-level-editor/provisional_bake.py
"""
import os, io, re, json, math, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ART = os.path.join(HERE, "art")

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    sys.exit("Can Pillow:  python -m pip install pillow")

ICON = 128          # canh icon (px)
TEXMAX = 256        # canh toi da cua texture xuat ra

# Huong den cua game, lay tu _SceneRoot.prefab: euler (20.71, -16.12, 19.79).
# Quy ra vector huong (Unity: den chieu theo +Z cua chinh no).
def light_dir():
    rx, ry = math.radians(20.71), math.radians(-16.12)
    v = [0.0, 0.0, 1.0]
    # xoay quanh X
    v = [v[0], v[1] * math.cos(rx) - v[2] * math.sin(rx), v[1] * math.sin(rx) + v[2] * math.cos(rx)]
    # xoay quanh Y
    v = [v[0] * math.cos(ry) + v[2] * math.sin(ry), v[1], -v[0] * math.sin(ry) + v[2] * math.cos(ry)]
    n = math.sqrt(sum(c * c for c in v))
    return [-c / n for c in v]        # huong TU be mat VE phia den


L = light_dir()
TOOLCOL = {}
AMBIENT = (0.212, 0.227, 0.259)       # m_AmbientSkyColor cua Game.unity
BANDS, BAND_SCALE, CONTRAST = 4, 0.56, 1.72     # mac dinh MK Toon trong project


def shape_of(mesh_paths, prefab):
    s = " ".join(mesh_paths + [prefab or ""]).lower()
    if "cone" in s or "xo_" in s:
        return "cone"
    if "plank" in s:
        return "plank"
    if "chum" in s or "jar" in s:
        return "jar"
    if "cylinder" in s:
        return "cyl"
    return "box"


def cel(x):
    """Chia sang thanh 4 bac giong _LightBands cua MK Toon."""
    x = max(0.0, min(1.0, x))
    b = math.floor(x * BANDS) / (BANDS - 1.0)
    b = min(1.0, b)
    return (b - 0.5) * BAND_SCALE + 0.5


def shade(nx, ny, nz, base):
    """Mau cuoi = (cel(N.L) + ambient) * mau nen, ep tuong phan giong _Contrast."""
    ndl = nx * L[0] + ny * L[1] + nz * L[2]
    lit = cel(ndl * 0.5 + 0.5)
    out = []
    for i, c in enumerate(base):
        v = c / 255.0
        v = (v - 0.5) * (1 + (CONTRAST - 1) * 0.35) + 0.5      # tuong phan diu hon shader that
        v = v * (lit * 0.85 + AMBIENT[i] * 1.1)
        out.append(max(0, min(255, int(v * 255 + 0.5))))
    return tuple(out)


def render_icon(shape, base, accent):
    """Ve mot khoi 1x1x1 theo phoi canh gan giong khung 3D cua tool."""
    S = ICON * 4                                   # ve lon roi thu nho = khu rang cua
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy, r = S * 0.5, S * 0.54, S * 0.33

    if shape == "box" or shape == "plank":
        w = r * (0.45 if shape == "plank" else 1.0)
        top = [(cx - w, cy - r * 0.55), (cx, cy - r), (cx + w, cy - r * 0.55), (cx, cy - r * 0.1)]
        left = [(cx - w, cy - r * 0.55), (cx, cy - r * 0.1), (cx, cy + r), (cx - w, cy + r * 0.45)]
        right = [(cx + w, cy - r * 0.55), (cx, cy - r * 0.1), (cx, cy + r), (cx + w, cy + r * 0.45)]
        d.polygon(left, fill=shade(-1, 0, 0, base))
        d.polygon(right, fill=shade(1, 0, 0, base))
        d.polygon(top, fill=shade(0, 1, 0, accent))
    elif shape == "cone":
        d.polygon([(cx, cy - r), (cx + r * 0.8, cy + r * 0.75), (cx - r * 0.8, cy + r * 0.75)],
                  fill=shade(-0.4, 0.3, -0.6, base))
        d.polygon([(cx, cy - r), (cx + r * 0.8, cy + r * 0.75), (cx, cy + r * 0.95)],
                  fill=shade(0.7, 0.2, -0.4, accent))
        d.ellipse([cx - r * 0.8, cy + r * 0.5, cx + r * 0.8, cy + r], fill=shade(0, -1, 0, base))
    else:                                           # cyl / jar
        wob = 0.78 if shape == "jar" else 0.70
        body = [cx - r * wob, cy - r * 0.72, cx + r * wob, cy + r * 0.95]
        if shape == "jar":
            d.ellipse([cx - r * 0.86, cy - r * 0.45, cx + r * 0.86, cy + r * 0.98],
                      fill=shade(-0.3, 0.1, -0.9, base))
            d.ellipse([cx - r * 0.42, cy - r * 0.95, cx + r * 0.42, cy - r * 0.3],
                      fill=shade(-0.2, 0.5, -0.8, accent))
        else:
            d.rectangle(body, fill=shade(-0.3, 0, -0.9, base))
            d.ellipse([body[0], body[1] - r * 0.22, body[2], body[1] + r * 0.22],
                      fill=shade(0, 1, 0, accent))
            d.ellipse([body[0], body[3] - r * 0.22, body[2], body[3] + r * 0.22],
                      fill=shade(0, -0.6, -0.5, base))
        # dai sang doc than tru
        hl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(hl).ellipse(
            [cx - r * wob * 0.55, cy - r * 0.55, cx - r * wob * 0.05, cy + r * 0.8],
            fill=(255, 255, 255, 42))
        img = Image.alpha_composite(img, hl.filter(ImageFilter.GaussianBlur(S * 0.02)))

    return img.resize((ICON, ICON), Image.LANCZOS)


def tool_colors(html_path):
    """Doc bang TYPES trong index.html -> {id: (r,g,b)}.

    Vi sao khong lay mau tu anh albedo: anh albedo la ATLAS ca vo lon (than + nhan +
    nap), nen mau "trung binh" hay "bao hoa nhat" thuong ra mau cua CAI NHAN chu khong
    phai mau than vo — lon la (xanh la) ra xanh ngoc, lon do ra hong. Bo ma mau trong
    TYPES la do nguoi lam tool chon tay va da doi chieu voi game, nen dung lam mau nen
    cho ban TAM la chuan nhat. Ban Unity render that thi khong can den no nua.
    """
    out = {}
    if not os.path.exists(html_path):
        return out
    t = io.open(html_path, encoding="utf-8").read()
    i = t.find("const TYPES = {")
    if i < 0:
        return out
    blk = t[i:t.find("const TYPES_BASE", i)]
    for m in re.finditer(r"^\s*(\d+)\s*:\{[^}]*?col:'#([0-9a-fA-F]{6})'", blk, re.M):
        h = m.group(2)
        out[int(m.group(1))] = tuple(int(h[k:k + 2], 16) for k in (0, 2, 4))
    return out


def avg_colors(path):
    """Mau trung binh + mau vung sang cua anh albedo (bo qua diem trong suot).
       Tra ve mau xam trung tinh neu file khong phai anh doc duoc (vd .renderTexture)."""
    try:
        im = Image.open(path).convert("RGBA")
    except Exception:
        return (170, 170, 170), (205, 205, 205)
    im.thumbnail((96, 96), Image.LANCZOS)
    px = [p for p in im.getdata() if p[3] > 24]
    if not px:
        return (170, 170, 170), (200, 200, 200)

    # Trung binh THUAN se ra mau xam: anh albedo cua lon/chum co rat nhieu vung nhan
    # trang-den, keo tut do bao hoa. Nen cham diem tung diem theo DO BAO HOA roi lay
    # trung binh CO TRONG SO — mau than vo do moi thang, dung nhu mat nguoi nhin.
    tot = [0.0, 0.0, 0.0]
    wsum = 0.0
    for r, g, b, _a in px:
        mx, mn = max(r, g, b), min(r, g, b)
        sat = (mx - mn) / 255.0
        w = 0.06 + sat * sat * 3.0          # gan nhu bo qua diem xam
        tot[0] += r * w; tot[1] += g * w; tot[2] += b * w; wsum += w
    base = tuple(max(0, min(255, int(c / wsum))) for c in tot)

    # keo sang len mot chut cho khoi khong bi chim tren nen toi cua bang mau
    mx = max(base) or 1
    if mx < 150:
        k = 150.0 / mx
        base = tuple(min(255, int(c * k)) for c in base)

    acc = tuple(min(255, int(c * 1.22 + 18)) for c in base)   # mat tren, sang hon
    return base, acc


def main():
    global TOOLCOL
    TOOLCOL = tool_colors(os.path.join(HERE, "index.html"))
    print("ma mau lay tu TYPES cua tool: %d id" % len(TOOLCOL))
    reg = json.loads(io.open(os.path.join(ART, "registry.json"), encoding="utf-8").read())
    os.makedirs(os.path.join(ART, "icons"), exist_ok=True)
    os.makedirs(os.path.join(ART, "textures"), exist_ok=True)

    # ---- xuat texture (thu nho) ----
    texmap, tex_fail = {}, []
    for mpath, mi in reg["materials"].items():
        a = mi.get("albedo")
        if not a:
            continue
        src = os.path.join(ROOT, a)
        # bo qua thu khong phai anh tinh (vd .renderTexture do shader nuoc/wormhole dung)
        if not a.lower().endswith((".png", ".jpg", ".jpeg", ".tga", ".psd", ".tif", ".tiff", ".exr")):
            tex_fail.append(a)
            continue
        if not os.path.exists(src):
            tex_fail.append(a)
            continue
        try:
            probe = Image.open(src)
            probe.close()
        except Exception:
            tex_fail.append(a)
            continue
        name = re.sub(r"[^A-Za-z0-9_.-]", "_", os.path.basename(a))
        dst = os.path.join(ART, "textures", os.path.splitext(name)[0] + ".png")
        if not os.path.exists(dst):
            im = Image.open(src).convert("RGBA")
            im.thumbnail((TEXMAX, TEXMAX), Image.LANCZOS)
            im.save(dst, optimize=True)
        texmap[a] = "textures/" + os.path.basename(dst)
    print("texture da xuat: %d  (loi: %d)" % (len(texmap), len(tex_fail)))

    # ---- icon cho tung id, tung game ----
    manifest = {"provisional": True, "icons": {}, "textures": texmap,
                "light": {"dir": L, "ambient": list(AMBIENT),
                          "bands": BANDS, "bandScale": BAND_SCALE, "contrast": CONTRAST},
                "camera": {"fov": 30}}
    cache = {}
    made = 0
    for game, rows in reg["games"].items():
        manifest["icons"][game] = {}
        for r in rows:
            mat = r.get("materialH") or r.get("materialDefault")
            mi = reg["materials"].get(mat or "", {})
            alb = mi.get("albedo")
            shape = shape_of(r.get("meshes") or [], r.get("prefab"))
            tc = TOOLCOL.get(r["id"])
            key = (shape, alb, tc)
            if key not in cache:
                if tc:                                   # uu tien ma mau da doi chieu cua tool
                    base = tc
                    acc = tuple(min(255, int(c * 1.22 + 18)) for c in base)
                elif alb and os.path.exists(os.path.join(ROOT, alb)):
                    base, acc = avg_colors(os.path.join(ROOT, alb))
                else:
                    base, acc = (170, 170, 170), (205, 205, 205)
                fn = "icons/%s__%s__%02x%02x%02x.png" % (
                    shape,
                    re.sub(r"[^A-Za-z0-9]", "_", os.path.splitext(os.path.basename(alb or "none"))[0])[:40],
                    base[0], base[1], base[2])
                render_icon(shape, base, acc).save(os.path.join(ART, fn), optimize=True)
                # Cung mot lo khoa voi ban Unity xuat ra (iso/front/top/side). Ban tam chi co
                # goc 3/4; runtime tu dung 'iso' cho ca 3 mat 2D khi thieu front/top/side.
                cache[key] = {"iso": fn, "base": "#%02x%02x%02x" % base, "shape": shape,
                              "tex": texmap.get(alb)}
                made += 1
            manifest["icons"][game][str(r["id"])] = cache[key]

    io.open(os.path.join(ART, "manifest.json"), "w", encoding="utf-8").write(
        json.dumps(manifest, indent=1, ensure_ascii=False))
    print("icon rieng biet da ve: %d" % made)
    for g in manifest["icons"]:
        print("  %-4s %d id co icon" % (g, len(manifest["icons"][g])))
    print("-> " + os.path.join(ART, "manifest.json"))


if __name__ == "__main__":
    main()
