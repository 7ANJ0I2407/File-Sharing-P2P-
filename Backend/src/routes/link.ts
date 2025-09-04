import { Router } from "express";
import express from "express";
import { createPlaceholder, attachFile, get, markUsedAndDelete } from "../linkStore";
import { putObject, getObjectStream, deleteObject } from "../storage/supabase";

export const linkRouter = Router();

// Only the upload route needs raw bodies (binary)
// linkRouter.use("/:id/upload", express.raw({ type: "*/*", limit: "25mb" }));

// 1) Init link
linkRouter.post("/init", async (req, res) => {
    const ttlSec = Math.max(10, Math.min(7 * 24 * 3600, Number(req.body?.ttlSeconds || 3600)));
    const rec = await createPlaceholder(ttlSec * 1000);
    res.json({ id: rec.id, token: rec.token });
});

// 2) Upload ciphertext (binary body)
// headers: x-file-name, x-iv, x-mime, x-size
linkRouter.post("/:id/upload", async (req, res) => {
    const id = req.params.id;
    const token = String(req.query.t || "");
    const rec = get(id);
    if (!rec) return res.status(404).json({ error: "not_found" });
    if (rec.token !== token) return res.status(403).json({ error: "bad_token" });
    if (rec.used) return res.status(410).json({ error: "used" });

    const filename = String(req.header("x-file-name") || "file");
    const ivB64 = String(req.header("x-iv") || "");
    const mime = String(req.header("x-mime") || "application/octet-stream");
    const size = Number(req.header("x-size") || 0);

    const buf: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
    if (!buf?.length) return res.status(400).json({ error: "empty_body" });

    try {
        await putObject(id, buf); // store ciphertext under key=id
        await attachFile(id, { objectKey: id, size, mime, filename, ivB64 });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: "upload_failed" });
    }
});

// 3) One-time download (streams + burns)
linkRouter.get("/:id/download", async (req, res) => {
    const id = req.params.id;
    const token = String(req.query.t || "");
    const rec = get(id);
    if (!rec) return res.status(404).json({ error: "not_found" });
    if (rec.token !== token) return res.status(403).json({ error: "bad_token" });
    if (rec.used) return res.status(410).json({ error: "gone" });
    if (!rec.file.objectKey) return res.status(409).json({ error: "no_upload_yet" });

    console.log("Download request for", id, "token ok");

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-File-Name", encodeURIComponent(rec.file.filename));
    res.setHeader("X-IV", rec.file.ivB64);
    res.setHeader("X-Mime", rec.file.mime);
    res.setHeader("X-Size", String(rec.file.size));

    try {
        const stream = await getObjectStream(rec.file.objectKey);
        stream.on("error", (e) => { console.error("Stream error:", e); res.destroy(e); });
        stream.pipe(res);

        let burned = false;
        const burnOnce = async () => {
            if (burned) return;      // ⭐ prevent double-burn logs
            burned = true;
            console.log("Burning link", id);
            try { await deleteObject(rec.file.objectKey); } catch (e) { console.warn("deleteObject", e); }
            try { await markUsedAndDelete(id); } catch (e) { console.warn("markUsed", e); }
        };

        res.once("finish", burnOnce);  // use .once
        res.once("close", burnOnce);   // handle client aborts
    } catch (e) {
        console.error("Download error", e);
        res.status(404).json({ error: "not_found" });
    }
});

