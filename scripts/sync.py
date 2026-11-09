#!/usr/bin/env python3
"""Rebuild index.html from the Claude artifact page and seed/reads.json from the
pre-pull row docs. Run after the Claude page or the rows change:

    python3 scripts/sync.py /path/to/visibility_read.html /path/to/docs2

Both inputs live in the pre-pull workspace, not in this repo."""
import json, sys, pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
docs = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None

if src:
    html = src.read_text()
    assert html.count("<script>\n(() => {") == 1, "main script marker not found"
    # Runtime shim before the app script
    html = html.replace("<script>\n(() => {", '<script src="/shim.js"></script>\n<script>\n(() => {', 1)
    # Host-specific copy
    html = html.replace(
        "Reads will go through the data desk (this view has no connector bridge). Open the page in a browser tab at claude.ai, shared to the organization, for direct pulls.",
        "Live pulls are not on this host yet. Every pre-loaded brand works from the Find box; for a brand that is not pre-loaded, run the read on the Claude page.")
    html = html.replace("Model recall needs a signed-in viewer.", "Model recall runs on the Claude page; it is part of the complimentary assessment.")
    html = html.replace("The capture log needs a signed-in viewer.", "Enter the booth passcode to open the capture log.")
    # Passcode switch next to New prospect
    html = html.replace('<button class="btn o s" id="clear" type="button">New prospect</button>',
        '<button class="btn o s" id="clear" type="button">New prospect</button> <button class="btn o s" id="passcode" type="button" title="Change the booth passcode on this device">Passcode</button>', 1)
    html = html.replace("$('clear').addEventListener('click',()=>{",
        "$('passcode').addEventListener('click',()=>{ if(window.__avrSignOut) window.__avrSignOut(); });\n$('clear').addEventListener('click',()=>{", 1)
    assert 'id="passcode"' in html and "__avrSignOut" in html
    (root / "index.html").write_text(html)
    print("index.html written,", len(html), "bytes")

if docs:
    ids = json.loads((docs / "_ids.json").read_text()) if (docs / "_ids.json").exists() else None
    rows = []
    for p in sorted(docs.glob("*.json")):
        if p.name.startswith("_"):
            continue
        rows.append({"id": p.stem, "data": json.loads(p.read_text())})
    (root / "seed" / "reads.json").write_text(json.dumps(rows, separators=(",", ":")))
    print("seed/reads.json written,", len(rows), "rows")
