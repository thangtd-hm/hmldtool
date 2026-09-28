# -*- coding: utf-8 -*-
"""
Nhung art pack vao index.html.

Chi ghi de doan giua 2 moc:
    <!--ART:BEGIN-->  ...  <!--ART:END-->
nen file HTML VAN LA MOT FILE DUY NHAT ban co the mo va sua tay nhu truoc.
Chay lai script nay bao nhieu lan cung duoc, ket qua khong doi (idempotent).

Chay:
    python tools/valley-smash-level-editor/inline_art.py
    python tools/valley-smash-level-editor/inline_art.py --no-textures   (chi nhung icon, nhe hon)
"""
import os, io, re, json, base64, sys, argparse, struct, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, "art")
HTML = os.path.join(HERE, "index.html")
BEGIN, END = "<!--ART:BEGIN-->", "<!--ART:END-->"

# The exporter bakes Valley Smash's ObjectDataTest under BOTH game keys. Since dev/main
# "update id jar" (2026-09-24) Valley Smash puts jar shades on ids 220-237, which mean other
# blocks in Ocean Block Shoot (220/221 new wood, 230 Nuclear bomb). Keep that art out of the
# OBS profile so those blocks keep their vector look there instead of turning into jars.
SKIP_IDS = {"obs": set(range(220, 238))}


try:
    from PIL import Image
except ImportError:
    Image = None


def data_uri(path, webp=True, quality=88):
    """Doc anh -> data URI. Mac dinh nen lai thanh WebP: bo icon PNG cua Unity nang
    ~2.5 MB, sang WebP con ~1/3 ma mat thuong khong phan biet duoc — quan trong vi
    tat ca deu nhet vao 1 file HTML. Khong co Pillow thi cu dung PNG goc."""
    ext = os.path.splitext(path)[1].lower()
    if webp and Image is not None and ext in (".png", ".webp"):
        try:
            im = Image.open(path).convert("RGBA")
            buf = io.BytesIO()
            im.save(buf, "WEBP", quality=quality, method=6)
            raw = buf.getvalue()
            if raw and len(raw) < os.path.getsize(path):      # chi dung khi that su nho hon
                return "data:image/webp;base64," + base64.b64encode(raw).decode("ascii")
        except Exception:
            pass
    mime = {".png": "image/png", ".webp": "image/webp",
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}.get(ext, "application/octet-stream")
    with open(path, "rb") as f:
        return "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode("ascii"))


def b64z(raw):
    """zlib (RFC 1950) roi base64: trinh duyet mo lai bang DecompressionStream('deflate')."""
    return base64.b64encode(zlib.compress(raw, 9)).decode("ascii")


def pack_mesh(d):
    """Mesh JSON (so thuc) -> ban nen "q1", ~6 lan nho hon, do lech toa do < 0.0001 don vi.

    position : int16 luong tu hoa trong hop bao cua chinh mesh (lo..hi tung truc)
    normal   : int8 (x127) — giu DUNG phap tuyen Unity xuat, khong tinh lai
               (tinh lai se lam tron canh cung cua hop/nap lon)
    uv       : uint16 trong khung ulo..uhi (UV co the tran ra ngoai 0..1)
    index    : hieu so voi chi so truoc (delta) + zigzag, uint16 hoac uint32 (k)
    Moi mang nen rieng bang zlib roi base64. Cach nen hoc tu tool Ocean Block Shoot
    (the OBS level_editor_v3_art.html), khac o cho giu phap tuyen that."""
    p = d.get("position") or []
    n = len(p) // 3
    lo = [min(p[i::3]) if n else 0.0 for i in range(3)]
    hi = [max(p[i::3]) if n else 0.0 for i in range(3)]
    span = [(hi[i] - lo[i]) or 1.0 for i in range(3)]
    q = [int(round((p[j] - lo[j % 3]) / span[j % 3] * 65535)) - 32768 for j in range(len(p))]
    out = {"fmt": "q1", "n": n, "lo": lo, "hi": hi, "p": b64z(struct.pack("<%dh" % len(q), *q))}
    nr = d.get("normal") or []
    if nr:
        qn = [max(-127, min(127, int(round(v * 127)))) for v in nr]
        out["nr"] = b64z(struct.pack("<%db" % len(qn), *qn))
    uv = d.get("uv") or []
    if uv:
        ulo = [min(uv[0::2]), min(uv[1::2])]
        uhi = [max(uv[0::2]), max(uv[1::2])]
        us = [(uhi[i] - ulo[i]) or 1.0 for i in range(2)]
        qu = [int(round((uv[j] - ulo[j % 2]) / us[j % 2] * 65535)) for j in range(len(uv))]
        out.update(ulo=ulo, uhi=uhi, u=b64z(struct.pack("<%dH" % len(qu), *qu)))
    idx = d.get("index") or []
    if idx:
        prev, zz = 0, []
        for v in idx:
            dv = v - prev
            prev = v
            zz.append(dv << 1 if dv >= 0 else ((-dv) << 1) - 1)
        k = 16 if max(zz) < 65536 else 32
        out.update(k=k, i=b64z(struct.pack("<%d%s" % (len(zz), "H" if k == 16 else "I"), *zz)))
    return out


def shade_tex(sh):
    """Anh ma thong so to bong tro toi (matcap + mask cua ho TCP2)."""
    return [sh[k] for k in ("matcap", "mask") if isinstance(sh, dict) and sh.get(k)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-textures", action="store_true",
                    help="bo qua texture (chi can cho khung 3D giai doan 2)")
    ap.add_argument("--no-meshes", action="store_true", help="bo qua mesh")
    ap.add_argument("--html", default=HTML)
    ap.add_argument("--no-webp", action="store_true", help="giu nguyen PNG, khong nen lai WebP")
    # Anh truc giao cua BIEN THE dai 2..5 o chiem ~2/3 file. q75 nhe hon q88 ~1/3 ma o co
    # ~96 px/o thi mat thuong khong phan biet; icon bang chon + anh 1 o van giu q88.
    ap.add_argument("--var-quality", type=int, default=75, help="chat luong WebP cho anh bien the")
    args = ap.parse_args()

    mpath = os.path.join(ART, "manifest.json")
    if not os.path.exists(mpath):
        sys.exit("Chua co %s.\nChay Unity: Tools > Level Editor > Export Art\n"
                 "hoac ban tam: python tools/valley-smash-level-editor/provisional_bake.py" % mpath)
    man = json.loads(io.open(mpath, encoding="utf-8").read())

    art = {
        "provisional": bool(man.get("provisional")),
        "generated": man.get("generated"),
        "light": man.get("light"), "camera": man.get("camera"),
        # 'unity' = mesh giu nguyen toa do Unity, de group flip (scale.z=-1) cua tool doi he.
        # Thieu khoa nay = ban xuat cu (da doi Z san) -> runtime tu doi nguoc lai.
        "coordinateSpace": man.get("coordinateSpace"),
        "icons": {}, "meshes": {}, "textures": {},
    }

    # ---- icon: nhung anh thanh data URI, gom trung lap ----
    pool, npix = {}, 0
    nemb = [0]

    def put(rel, quality=88):
        nonlocal npix
        if not rel:
            return None
        if rel in pool:
            return pool[rel]
        p = os.path.join(ART, rel.replace("/", os.sep))
        if not os.path.exists(p):
            return None
        pool[rel] = data_uri(p, webp=not args.no_webp, quality=quality)
        npix += os.path.getsize(p)
        nemb[0] += (len(pool[rel]) - pool[rel].index(",") - 1) * 3 // 4
        return pool[rel]

    # bang tra: data URI duoc luu 1 lan trong "blobs", icon chi giu chi so -> file khong phinh
    blobs, blob_idx = [], {}

    def ref(rel, quality=88):
        uri = put(rel, quality)
        if uri is None:
            return None
        if uri not in blob_idx:
            blob_idx[uri] = len(blobs)
            blobs.append(uri)
        return blob_idx[uri]

    nid = 0
    used_mesh, used_tex = set(), set()
    for game, ids in (man.get("icons") or {}).items():
        g = {}
        skip = SKIP_IDS.get(game, set())
        for sid, e in ids.items():
            if sid.lstrip("-").isdigit() and int(sid) in skip:
                continue
            row = {}
            for view in ("iso", "front", "top", "side"):
                i = ref(e.get(view))
                if i is not None:
                    row[view] = i
            if e.get("base"):
                row["base"] = e["base"]
            if e.get("shape"):
                row["shape"] = e["shape"]
            for k in ("mesh", "tex", "shade"):
                if e.get(k):
                    row[k] = e[k]
            if e.get("mesh"):
                used_mesh.add(e["mesh"])
            if e.get("tex"):
                used_tex.add(e["tex"])
            used_tex.update(shade_tex(e.get("shade")))
            # Bien the kich thuoc (2x..5z): moi co la mot mesh + bo anh RIENG, khong phai
            # khoi 1 o keo dan. Nhung y het entry goc, chi bo "iso" vi bang mau chi bay
            # khoi 1x1. Anh trung noi dung tu gop chung blob nen 2x/2z thuong khong ton them.
            vv = {}
            for vk, ve in (e.get("var") or {}).items():
                vrow = {}
                for view in ("front", "top", "side"):
                    i = ref(ve.get(view), args.var_quality)
                    if i is not None:
                        vrow[view] = i
                for k in ("mesh", "tex", "shade"):
                    if ve.get(k):
                        vrow[k] = ve[k]
                if ve.get("mesh"):
                    used_mesh.add(ve["mesh"])
                if ve.get("tex"):
                    used_tex.add(ve["tex"])
                used_tex.update(shade_tex(ve.get("shade")))
                if vrow:
                    vv[vk] = vrow
            if vv:
                row["var"] = vv
            # chi tinh la "co icon" khi THUC SU nhung duoc it nhat 1 anh —
            # neu chi co base/shape thi runtime van phai ve bang hinh khoi cu
            if row:
                g[sid] = row
                if any(k in row for k in ("iso", "front", "top", "side")):
                    nid += 1
        art["icons"][game] = g

    # Ban cua game (Raft.prefab): cac manh + ma tran tuyen tinh theo dim, xem BakeTable
    # trong LevelEditorArtExporter.cs. Mesh/anh cua no di chung kho voi khoi.
    table = man.get("table")
    if table:
        for part in table.get("parts") or []:
            if part.get("mesh"):
                used_mesh.add(part["mesh"])
            if part.get("tex"):
                used_tex.add(part["tex"])
            used_tex.update(shade_tex(part.get("shade")))
        art["table"] = table

    if not args.no_meshes:
        for name, rel in (man.get("meshes") or {}).items():
            if name not in used_mesh:
                continue
            p = os.path.join(ART, rel.replace("/", os.sep))
            if not os.path.exists(p):
                continue
            art["meshes"][name] = pack_mesh(json.loads(io.open(p, encoding="utf-8").read()))

    if not args.no_textures:
        for name, rel in (man.get("textures") or {}).items():
            if name not in used_tex:
                continue           # anh khong id nao tro toi -> khong nhung cho nang file
            i = ref(rel)
            if i is not None:
                art["textures"][name] = i

    art["blobs"] = blobs

    payload = json.dumps(art, separators=(",", ":"), ensure_ascii=False)
    block = (BEGIN + "\n<script>\n"
             "/* Sinh tu dong boi tools/valley-smash-level-editor/inline_art.py — DUNG SUA TAY.\n"
             "   Nguon: tools/valley-smash-level-editor/art/manifest.json  (provisional=%s)\n"
             "   Anh nam trong ART.blobs; ART.icons[game][id].iso la CHI SO vao mang do. */\n"
             "window.ART=%s;\n</script>\n" % (art["provisional"], payload)) + END

    if not os.path.exists(args.html):
        sys.exit("Khong thay %s" % args.html)
    html = io.open(args.html, encoding="utf-8").read()
    if BEGIN not in html or END not in html:
        sys.exit("Khong thay moc %s / %s trong %s" % (BEGIN, END, args.html))

    new = re.sub(re.escape(BEGIN) + r".*?" + re.escape(END), lambda m: block, html, count=1, flags=re.S)
    io.open(args.html, "w", encoding="utf-8").write(new)

    print("icon da nhung : %d id co anh  (%d anh rieng biet)" % (nid, len(blobs)))
    if nid == 0:
        print("  !! KHONG co anh nao duoc nhung — kiem tra manifest.json co khoa"
              " 'iso'/'front'/'top'/'side' khong")
    print("mesh          : %d" % len(art["meshes"]))
    print("texture       : %d" % len(art["textures"]))
    print("anh goc       : %.0f KB  ->  sau nen %.0f KB  ->  payload %.0f KB"
          % (npix / 1024.0, nemb[0] / 1024.0, len(payload) / 1024.0))
    print("HTML          : %.1f KB  (%s)" % (len(new) / 1024.0, args.html))
    if art["provisional"]:
        print("\nLUU Y: dang dung art BAN TAM (ve bang Python).")
        print("Chay Unity  Tools > Level Editor > Export Art  roi chay lai script nay")
        print("de thay bang anh render that cua game.")


if __name__ == "__main__":
    main()
