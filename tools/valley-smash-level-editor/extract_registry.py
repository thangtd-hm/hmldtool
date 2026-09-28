# -*- coding: utf-8 -*-
"""
Doc ObjectDataTest*.asset cua Unity va lap bang:  id -> prefab -> mesh + material + anh albedo.

Chay:  python tools/valley-smash-level-editor/extract_registry.py
Ket qua: tools/valley-smash-level-editor/art/registry.json

Script nay KHONG can mo Unity - no doc thang file YAML cua Unity. Dung cho ca
2 muc dich: (a) bake tam bang Python, (b) doi chieu voi ban Unity xuat ra.
"""
import os, io, re, json, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ART = os.path.join(HERE, "art")

# Ca hai deu doc ObjectDataTest.asset: do la config duy nhat ma GameModuleConfig.asset
# tro toi, tuc la thu game that chay. ObjectDataTestCarnival.asset khong ai tham chieu
# (theme hoi cho lam do) va prefab cua no tat BS_FishCan de bat OBS_can, nen doc no cho
# "vs" se ra lon soc do thay vi lon xanh huy hieu vang. Xem chu thich cung noi dung
# trong LevelEditorArtExporter.cs.
OBJECT_DATA = "Assets/_BaseCode/Modules/Gameplay/Configs/ObjectDataTest.asset"
CONFIGS = {
    "obs": OBJECT_DATA,
    "vs": OBJECT_DATA,
}


def rd(p):
    return io.open(p, encoding="utf-8", errors="replace").read()


def build_guid_index(root):
    """guid -> duong dan tuong doi tu goc repo (lay tu cac file .meta)."""
    idx = {}
    for dirpath, dirnames, files in os.walk(os.path.join(root, "Assets")):
        dirnames[:] = [d for d in dirnames if d not in ("Library", "Temp", "obj", ".git")]
        for f in files:
            if not f.endswith(".meta"):
                continue
            fp = os.path.join(dirpath, f)
            try:
                head = io.open(fp, encoding="utf-8", errors="replace").read(300)
            except OSError:
                continue
            m = re.search(r"guid: ([0-9a-f]{32})", head)
            if m:
                idx[m.group(1)] = os.path.relpath(fp[:-5], root).replace(os.sep, "/")
    return idx


def prefab_meshes(path, idx, root, depth=0, seen=None):
    """Mesh hien thi cua prefab, lan ca vao prefab long nhau."""
    seen = seen if seen is not None else set()
    full = os.path.join(root, path)
    if path in seen or not os.path.exists(full):
        return []
    seen.add(path)
    t = rd(full)
    out = []
    for g in re.findall(r"m_Mesh: \{fileID: -?\d+, guid: ([0-9a-f]{32})", t):
        p = idx.get(g)
        if p and p not in out:
            out.append(p)
    if depth < 4:
        for g in re.findall(r"m_SourcePrefab: \{fileID: \d+, guid: ([0-9a-f]{32})", t):
            child = idx.get(g)
            if child:
                for m in prefab_meshes(child, idx, root, depth + 1, seen):
                    if m not in out:
                        out.append(m)
    return out


def prefab_materials(path, idx, root, depth=0, seen=None):
    """Material gan tren renderer cua prefab, lan ca vao prefab long nhau.
       Can thiet vi phan lon prefab chi la vo boc, MeshRenderer nam trong prefab con."""
    seen = seen if seen is not None else set()
    full = os.path.join(root, path)
    if path in seen or not os.path.exists(full):
        return []
    seen.add(path)
    t = rd(full)
    out = []
    for blk in re.finditer(r"m_Materials:\s*\n((?:\s+- \{fileID: -?\d+(?:, guid: [0-9a-f]{32})?[^\n]*\n)+)", t):
        for g in re.findall(r"guid: ([0-9a-f]{32})", blk.group(1)):
            p = idx.get(g)
            if p and p.endswith(".mat") and p not in out:
                out.append(p)
    # material ghi de trong PrefabInstance (m_Modifications) — hay gap o prefab bien the
    for g in re.findall(r"objectReference: \{fileID: -?\d+, guid: ([0-9a-f]{32})", t):
        p = idx.get(g)
        if p and p.endswith(".mat") and p not in out:
            out.append(p)
    if depth < 4:
        for g in re.findall(r"m_SourcePrefab: \{fileID: \d+, guid: ([0-9a-f]{32})", t):
            child = idx.get(g)
            if not child:
                continue
            if child.lower().endswith((".fbx", ".obj", ".blend")):
                # Prefab boc quanh 1 MODEL da import: material khong nam trong prefab ma nam
                # o phan remap "externalObjects" trong file .meta cua model.
                out += [m for m in fbx_materials(child, idx, root) if m not in out]
            else:
                for m in prefab_materials(child, idx, root, depth + 1, seen):
                    if m not in out:
                        out.append(m)
    return out


def fbx_materials(fbx_path, idx, root):
    """Material duoc remap cho 1 model da import, doc tu <model>.meta -> externalObjects."""
    meta = os.path.join(root, fbx_path + ".meta")
    if not os.path.exists(meta):
        return []
    t = rd(meta)
    out = []
    for m in re.finditer(
            r"- first:\s*\n\s+type: UnityEngine:Material\s*\n\s+assembly: [^\n]*\n\s+name: ([^\n]*)\n"
            r"\s+second: \{fileID: -?\d+, guid: ([0-9a-f]{32})", t):
        p = idx.get(m.group(2))
        if p and p.endswith(".mat") and p not in out:
            out.append(p)
    return out


def material_info(path, idx, root):
    """Shader + anh albedo + mau + thong so cel cua 1 material."""
    full = os.path.join(root, path)
    if not os.path.exists(full):
        return None
    t = rd(full)
    info = {"path": path}
    m = re.search(r"m_Shader: \{fileID: -?\d+, guid: ([0-9a-f]{32})", t)
    info["shader"] = idx.get(m.group(1), "?") if m else "?"

    # anh albedo: uu tien _AlbedoMap (MK Toon), roi _BaseMap / _MainTex
    tex = {}
    for m in re.finditer(r"- _(\w+):\s*\n\s+m_Texture: \{fileID: \d+(?:, guid: ([0-9a-f]{32}))?", t):
        if m.group(2):
            tex[m.group(1)] = idx.get(m.group(2))
    for key in ("AlbedoMap", "BaseMap", "MainTex"):
        if tex.get(key):
            info["albedo"] = tex[key]
            break
    info["textures"] = tex

    def num(name, default=None):
        m = re.search(r"- _%s: ([-\d.eE+]+)\s*\n" % name, t)
        return float(m.group(1)) if m else default

    def col(name):
        m = re.search(r"- _%s: \{r: ([-\d.eE+]+), g: ([-\d.eE+]+), b: ([-\d.eE+]+), a: ([-\d.eE+]+)\}" % name, t)
        return [float(x) for x in m.groups()] if m else None

    info["cel"] = {
        "lightBands": num("LightBands", 4),
        "lightBandsScale": num("LightBandsScale", 0.56),
        "contrast": num("Contrast", 1.0),
        "brightness": num("Brightness", 1.0),
        "outlineSize": num("OutlineSize", num("Outline", 0)),
    }
    info["color"] = col("AlbedoColor") or col("BaseColor") or col("Color") or [1, 1, 1, 1]
    info["outlineColor"] = col("OutlineColor")
    return info


def parse_config(path, idx, root):
    full = os.path.join(root, path)
    if not os.path.exists(full):
        return []
    src = rd(full)
    entries = []
    for blk in re.split(r"\n  - id: ", src)[1:]:
        m0 = re.match(r"\s*(-?\d+)", blk)
        if not m0:
            continue
        e = {"id": int(m0.group(1))}
        mm = re.search(r"\n    mass: ([-\d.eE+]+)", blk)
        e["mass"] = float(mm.group(1)) if mm else None
        pg = re.search(r"\n    prefab: \{fileID: -?\d+, guid: ([0-9a-f]{32})", blk)
        e["prefab"] = idx.get(pg.group(1)) if pg else None
        ov = re.search(r"\n    overrideMaterial: (\d+)", blk)
        e["overrideMaterial"] = bool(int(ov.group(1))) if ov else False
        for field in ("horizontalMaterial", "verticalMaterial"):
            g = re.search(r"\n    %s: \{fileID: -?\d+, guid: ([0-9a-f]{32})" % field, blk)
            e[field] = idx.get(g.group(1)) if g else None
        entries.append(e)
    return entries


def main():
    os.makedirs(ART, exist_ok=True)
    print("Lap chi muc GUID...")
    idx = build_guid_index(ROOT)
    print("  %d guid" % len(idx))

    out = {"games": {}, "materials": {}, "meshes": []}
    meshes = []

    for game, cfg in CONFIGS.items():
        entries = parse_config(cfg, idx, ROOT)
        print("%s: %d muc (%s)" % (game, len(entries), os.path.basename(cfg)))
        rows = []
        # Game tra cuu bang ObjectDataTest.GetObjectData(id) -> tra ve ban GHI DAU TIEN khop id.
        # ObjectDataTest.asset dang co id trung (id 1 xuat hien 2 lan) va id am (-1) => phai
        # loc y het game, khong thi icon cua id 1 se lay nham ban ghi cuoi (Plank).
        seen_ids = set()
        for e in entries:
            if not e["prefab"]:
                continue
            if e["id"] < 0 or e["id"] in seen_ids:
                continue
            seen_ids.add(e["id"])
            ms = prefab_meshes(e["prefab"], idx, ROOT)
            for m in ms:
                if m not in meshes:
                    meshes.append(m)
            mat = e["horizontalMaterial"] or e["verticalMaterial"]
            if mat and mat not in out["materials"]:
                mi = material_info(mat, idx, ROOT)
                if mi:
                    out["materials"][mat] = mi
            rows.append({
                "id": e["id"], "mass": e["mass"], "prefab": e["prefab"],
                "meshes": ms,
                "materialH": e["horizontalMaterial"], "materialV": e["verticalMaterial"],
                "overrideMaterial": e["overrideMaterial"],
            })
        out["games"][game] = rows

    # material MAC DINH cua tung prefab (khi id khong ghi de material)
    print("Doc material mac dinh cua prefab...")
    for game, rows in out["games"].items():
        for r in rows:
            if r["materialH"]:
                continue
            mats = prefab_materials(r["prefab"], idx, ROOT)
            # bo qua material chi dung cho hieu ung vo/tan (Shatter) — khong phai be mat chinh
            main = [m for m in mats if "shatter" not in os.path.basename(m).lower()]
            found = (main or mats or [None])[0]
            if found:
                r["materialDefault"] = found
                r["materialCandidates"] = mats[:4]
                if found not in out["materials"]:
                    mi = material_info(found, idx, ROOT)
                    if mi:
                        out["materials"][found] = mi

    out["meshes"] = meshes
    io.open(os.path.join(ART, "registry.json"), "w", encoding="utf-8").write(
        json.dumps(out, indent=1, ensure_ascii=False))

    print()
    print("mesh rieng biet : %d" % len(meshes))
    print("material        : %d" % len(out["materials"]))
    withtex = [m for m in out["materials"].values() if m.get("albedo")]
    print("  co anh albedo : %d" % len(withtex))
    for g, rows in out["games"].items():
        nom = len([r for r in rows if not (r["materialH"] or r.get("materialDefault"))])
        print("%-4s id co prefab: %3d | thieu material: %d" % (g, len(rows), nom))
    print()
    print("-> " + os.path.join(ART, "registry.json"))


if __name__ == "__main__":
    main()
