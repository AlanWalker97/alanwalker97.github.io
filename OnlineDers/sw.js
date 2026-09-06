let githubOwner = null;
let githubRepo = null;
let githubToken = null;
let githubConfigLoadPromise = null;
let currentLesson = null;
let loadingLessonPromise = null;
const LESSON_CACHE = "OnlineDersStorage";
self.addEventListener("install", event => {
    console.log("[SW] Installed");
    self.skipWaiting();
});
self.addEventListener("activate", event => {
    console.log("[SW] Activated");
    event.waitUntil(self.clients.claim());
});
self.addEventListener("message", event => {
    if (event.data?.type === "SET_GITHUB_CONFIG") {
        githubOwner = event.data.owner;
        githubRepo = event.data.repo;
        githubToken = event.data.token;
        console.log("[SW] GitHub ayarları alındı:", githubOwner, githubRepo);
        event.waitUntil(saveGitHubConfig());
        return;
    }
    if (event.data?.type === "LOAD_LESSON") {
        const lessonPath = event.data.lessonPath;
        const port = event.ports[0];
        console.log("[SW] Ders yükleme isteği:", lessonPath);
        event.waitUntil(loadLesson(lessonPath).then(() => {
            console.log("[SW] Ders Cache Storage'a tamamen yüklendi:", lessonPath);
            if (port) {
                port.postMessage({
                    type: "LESSON_READY"
                });
            }
        }).catch(error => {
            console.error("[SW] Ders yükleme hatası:", error);
            if (port) {
                port.postMessage({
                    type: "LESSON_ERROR",
                    error: error.message
                });
            }
        }));
    }
});

function openConfigDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("OnlineDersSW", 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore("config");
        };
        request.onsuccess = () => {
            resolve(request.result);
        };
        request.onerror = () => {
            reject(request.error);
        };
    });
}
async function saveGitHubConfig() {
    const db = await openConfigDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction("config", "readwrite");
        tx.objectStore("config").put({
            owner: githubOwner,
            repo: githubRepo,
            token: githubToken
        }, "github");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    db.close();
    console.log("[SW] GitHub ayarları IndexedDB'ye kaydedildi.");
}
async function loadGitHubConfig() {
    if (githubOwner && githubRepo && githubToken) {
        return true;
    }
    if (!githubConfigLoadPromise) {
        githubConfigLoadPromise = (async () => {
            const db = await openConfigDB();
            const config = await new Promise((resolve, reject) => {
                const tx = db.transaction("config", "readonly");
                const request = tx.objectStore("config").get("github");
                request.onsuccess = () => {
                    resolve(request.result);
                };
                request.onerror = () => {
                    reject(request.error);
                };
            });
            db.close();
            if (config) {
                githubOwner = config.owner;
                githubRepo = config.repo;
                githubToken = config.token;
                console.log("[SW] GitHub ayarları IndexedDB'den geri yüklendi.");
                return true;
            }
            return false;
        })();
    }
    return await githubConfigLoadPromise;
}
async function waitForGitHubConfig() {
    if (githubOwner && githubRepo && githubToken) {
        return;
    }
    console.log("[SW] GitHub ayarları IndexedDB'den yükleniyor...");
    const loaded = await loadGitHubConfig();
    if (!loaded || !githubOwner || !githubRepo || !githubToken) {
        throw new Error("GitHub ayarları bulunamadı.");
    }
    console.log("[SW] GitHub ayarları hazır:", githubOwner, githubRepo);
}
async function saveActiveLesson(lessonPath) {
    const db = await openConfigDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction("config", "readwrite");
        tx.objectStore("config").put(lessonPath, "activeLesson");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}
async function loadActiveLesson() {
    const db = await openConfigDB();
    const lessonPath = await new Promise((resolve, reject) => {
        const tx = db.transaction("config", "readonly");
        const request = tx.objectStore("config").get("activeLesson");
        request.onsuccess = () => {
            resolve(request.result);
        };
        request.onerror = () => {
            reject(request.error);
        };
    });
    db.close();
    return lessonPath || null;
}

function getGitHubApiUrl(githubPath) {
    if (!githubOwner || !githubRepo || !githubToken) {
        throw new Error("GitHub ayarları Service Worker'a gönderilmemiş.");
    }
    const cleanPath = githubPath.replace(/^\/+/, "");
    const encodedPath = cleanPath.split("/").map(part => encodeURIComponent(part)).join("/");
    return ("https://api.github.com/repos/" + encodeURIComponent(githubOwner) + "/" + encodeURIComponent(githubRepo) + "/contents/" + encodedPath + "?ref=main");
}
async function githubRequest(githubPath) {
    const apiUrl = getGitHubApiUrl(githubPath);
    console.log("[SW] GitHub:", githubPath);
    const response = await fetch(apiUrl, {
        headers: {
            "Accept": "application/vnd.github.raw+json",
            "Authorization": `Bearer ${githubToken}`,
            "X-GitHub-Api-Version": "2026-03-10"
        }
    });
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        let errorText = "";
        try {
            errorText = await response.text();
        } catch (_) {
            errorText = "";
        }
        throw new Error(`GitHub API hatası: ${response.status}` + (errorText ? ` - ${errorText}` : ""));
    }
    return response;
}
async function listGitHubDirectory(directoryPath) {
    const apiUrl = getGitHubApiUrl(directoryPath);
    const response = await fetch(apiUrl, {
        headers: {
            "Accept": "application/vnd.github+json",
            "Authorization": `Bearer ${githubToken}`,
            "X-GitHub-Api-Version": "2026-03-10"
        }
    });
    if (response.status === 404) {
        throw new Error("Ders klasörü GitHub'da bulunamadı:\n" + directoryPath);
    }
    if (!response.ok) {
        let errorText = "";
        try {
            errorText = await response.text();
        } catch (_) {
            errorText = "";
        }
        throw new Error(`GitHub klasör listeleme hatası: ${response.status}` + (errorText ? ` - ${errorText}` : ""));
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
        throw new Error("GitHub'dan klasör listesi alınamadı.");
    }
    return data;
}
async function findAllFiles(directoryPath) {
    const entries = await listGitHubDirectory(directoryPath);
    const files = [];
    for (const entry of entries) {
        if (entry.type === "file") {
            files.push(entry.path);
            continue;
        }
        if (entry.type === "dir") {
            const subFiles = await findAllFiles(entry.path);
            files.push(...subFiles);
        }
    }
    return files;
}

function getCacheUrl(lessonPath, relativePath) {
    return ("https://online-ders-cache.local/" + encodeLessonPath(lessonPath) + "/" + relativePath.split("/").map(part => encodeURIComponent(part)).join("/"));
}
async function loadLesson(lessonPath) {
    if (loadingLessonPromise) {
        await loadingLessonPromise;
        return;
    }
    loadingLessonPromise = loadLessonInternal(lessonPath);
    try {
        await loadingLessonPromise;
    } finally {
        loadingLessonPromise = null;
    }
}
async function loadLessonInternal(lessonPath) {
    await waitForGitHubConfig();
    const cleanLessonPath = lessonPath.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!cleanLessonPath) {
        throw new Error("Geçersiz ders klasörü.");
    }
    console.log("[SW] Ders klasörü:", cleanLessonPath);
    console.log("[SW] Eski ders Cache Storage'dan siliniyor...");
    await caches.delete(LESSON_CACHE);
    const cache = await caches.open(LESSON_CACHE);
    console.log("[SW] Ders dosyaları keşfediliyor...");
    const githubFiles = await findAllFiles(cleanLessonPath);
    console.log("[SW] Bulunan dosya sayısı:", githubFiles.length);
    if (githubFiles.length === 0) {
        throw new Error("Ders klasörü boş.");
    }
    const CONCURRENCY = 40;
    for (let i = 0; i < githubFiles.length; i += CONCURRENCY) {
        const batch = githubFiles.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (githubFilePath, batchIndex) => {
            const fileIndex = i + batchIndex;
            console.log(`[SW] Dosya ${fileIndex + 1}/${githubFiles.length}:`, githubFilePath);
            const response = await githubRequest(githubFilePath);
            if (!response) {
                throw new Error("Dosya bulunamadı:\n" + githubFilePath);
            }
            const buffer = await response.arrayBuffer();
            let relativePath = githubFilePath.slice(cleanLessonPath.length);
            relativePath = relativePath.replace(/^\/+/, "");
            const cacheUrl = getCacheUrl(cleanLessonPath, relativePath);
            await cache.put(cacheUrl, new Response(buffer, {
                headers: {
                    "Content-Type": getContentType(relativePath),
                    "Content-Length": String(buffer.byteLength)
                }
            }));
            console.log("[SW] Cache'e alındı:", relativePath, "(", buffer.byteLength, "bytes )");
        }));
        console.log(`[SW] Batch tamamlandı: ${Math.min(
                i + CONCURRENCY,
                githubFiles.length
            )}/${githubFiles.length}`);
    }
    const indexResponse = await cache.match(getCacheUrl(cleanLessonPath, "index.html"));
    if (!indexResponse) {
        throw new Error("Ders klasöründe index.html bulunamadı.");
    }
    currentLesson = {
        path: cleanLessonPath
    };
    await saveActiveLesson(cleanLessonPath);
    console.log("[SW] DERS CACHE STORAGE'A ALINDI");
    console.log("[SW] Klasör:", cleanLessonPath);
    console.log("[SW] Dosya sayısı:", githubFiles.length);
}
async function ensureCurrentLesson() {
    if (currentLesson) {
        return true;
    }
    const activeLesson = await loadActiveLesson();
    if (!activeLesson) {
        return false;
    }
    const cache = await caches.open(LESSON_CACHE);
    const indexResponse = await cache.match(getCacheUrl(activeLesson, "index.html"));
    if (!indexResponse) {
        return false;
    }
    currentLesson = {
        path: activeLesson
    };
    console.log("[SW] Aktif ders Cache Storage'dan bulundu:", activeLesson);
    return true;
}
async function ensureLessonFromUrl(pathname) {
    if (currentLesson) {
        return;
    }
    const encodedLessonPath = pathname.split("/")[1];
    if (!encodedLessonPath) {
        throw new Error("Ders yolu URL'den alınamadı.");
    }
    const lessonPath = decodeURIComponent(encodedLessonPath);
    const activeLesson = await loadActiveLesson();
    if (activeLesson !== lessonPath) {
        throw new Error("URL'deki ders ile aktif ders eşleşmiyor.");
    }
    const cache = await caches.open(LESSON_CACHE);
    const indexResponse = await cache.match(getCacheUrl(lessonPath, "index.html"));
    if (!indexResponse) {
        throw new Error("Ders Cache Storage'da bulunamadı.");
    }
    currentLesson = {
        path: lessonPath
    };
    console.log("[SW] Ders Cache Storage'dan geri yüklendi:", lessonPath);
}
self.addEventListener("fetch", event => {
    const request = event.request;
    const url = new URL(request.url);
    console.log("[SW FETCH]", url.pathname, "Range:", request.headers.get("Range"));
    if (url.pathname === "/dersizle.html" || url.pathname.endsWith("/dersizle.html")) {
        event.respondWith(ensureCurrentLesson().then(ready => {
            if (!ready) {
                return fetch(request);
            }
            return serveLessonIndex();
        }).catch(error => {
            console.error("[SW] Ders index yüklenemedi:", error);
            return new Response("Ders yüklenemedi:\n" + error.message, {
                status: 500
            });
        }));
        return;
    }
    if (url.pathname === "/OnlineDers/" || url.pathname === "/OnlineDers/index.html") {
        return;
    }
    const firstSegment = url.pathname.split("/")[1];
    if (!firstSegment) {
        return;
    }
    if (!currentLesson) {
        event.respondWith(ensureLessonFromUrl(url.pathname).then(() => serveLessonFile(request, url.pathname)).catch(error => {
            console.error("[SW] Ders dosyası yüklenemedi:", error);
            return new Response("Ders dosyası yüklenemedi:\n" + error.message, {
                status: 500
            });
        }));
        return;
    }
    const lessonRoot = "/OnlineDers/" + encodeLessonPath(currentLesson.path);
    if (url.pathname === lessonRoot || url.pathname.startsWith(lessonRoot + "/")) {
        event.respondWith(serveLessonFile(request, url.pathname));
    }
});
async function serveLessonIndex() {
    const cache = await caches.open(LESSON_CACHE);
    const response = await cache.match(getCacheUrl(currentLesson.path, "index.html"));
    if (!response) {
        return new Response("Ders index.html bulunamadı.", {
            status: 404
        });
    }
    const html = await response.text();
    const baseHref = "/OnlineDers/" + encodeLessonPath(currentLesson.path) + "/";
    const baseTag = `<base href="${baseHref}">`;
    let modifiedHtml;
    if (/<base\s/i.test(html)) {
        modifiedHtml = html.replace(/<base\b[^>]*>/i, baseTag);
    } else {
        modifiedHtml = html.replace(/<head\b[^>]*>/i, match => match + baseTag);
    }
    return new Response(modifiedHtml, {
        status: 200,
        headers: {
            "Content-Type": "text/html; charset=utf-8"
        }
    });
}
async function serveLessonFile(request, pathname) {
    const lessonRoot = "/OnlineDers/" + encodeLessonPath(currentLesson.path);
    let relativePath = pathname.slice(lessonRoot.length);
    relativePath = decodeURIComponent(relativePath);
    relativePath = relativePath.replace(/^\/+/, "");
    if (!relativePath) {
        relativePath = "index.html";
    }
    if (isVideoRequest(relativePath)) {
        return serveVideo(request, relativePath);
    }
    const cache = await caches.open(LESSON_CACHE);
    const response = await cache.match(getCacheUrl(currentLesson.path, relativePath));
    if (!response) {
        console.error("[SW] Cache'de dosya bulunamadı:", relativePath);
        return new Response("Dosya Cache Storage'da bulunamadı:\n" + relativePath, {
            status: 404
        });
    }
    console.log("[SW] CACHE →", relativePath);
    return response;
}

function isVideoRequest(relativePath) {
    const lower = relativePath.toLowerCase();
    return (lower.endsWith(".mp4") || lower.endsWith(".webm"));
}
async function serveVideo(request, videoPath) {
    console.log("[SW] VİDEO İSTEĞİ:", videoPath);
    const parts = await getVideoParts(videoPath);
    if (parts.length === 0) {
        console.error("[SW] Video part dosyaları bulunamadı:", videoPath);
        return new Response("Video part dosyaları Cache Storage'da bulunamadı.", {
            status: 404
        });
    }
    let totalSize = 0;
    for (const part of parts) {
        totalSize += part.buffer.byteLength;
    }
    console.log("[SW] Video part sayısı:", parts.length);
    console.log("[SW] Video toplam boyutu:", totalSize, "bytes");
    const contentType = videoPath.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4";
    const rangeHeader = request.headers.get("Range");
    if (!rangeHeader) {
        console.log("[SW] Video Range olmadan istendi.");
        const fullBuffer = combineVideoParts(parts, 0, totalSize - 1);
        return new Response(fullBuffer, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Content-Length": String(totalSize),
                "Accept-Ranges": "bytes"
            }
        });
    }
    const range = parseRange(rangeHeader, totalSize);
    if (!range) {
        console.error("[SW] Geçersiz Range:", rangeHeader);
        return new Response(null, {
            status: 416,
            headers: {
                "Content-Range": `bytes */${totalSize}`
            }
        });
    }
    const start = range.start;
    const end = range.end;
    const contentLength = end - start + 1;
    console.log("[SW] Video Range:", start, "-", end);
    const responseBuffer = combineVideoParts(parts, start, end);
    console.log("[SW] CACHE → Video Range:", contentLength, "bytes");
    return new Response(responseBuffer, {
        status: 206,
        headers: {
            "Content-Type": contentType,
            "Content-Length": String(contentLength),
            "Content-Range": `bytes ${start}-${end}/${totalSize}`,
            "Accept-Ranges": "bytes"
        }
    });
}
async function getVideoParts(videoPath) {
    const cache = await caches.open(LESSON_CACHE);
    const requests = await cache.keys();
    const prefix = getCacheUrl(currentLesson.path, videoPath + ".part");
    const result = [];
    for (const request of requests) {
        if (!request.url.startsWith(prefix)) {
            continue;
        }
        const suffix = request.url.slice(prefix.length);
        if (!/^\d+$/.test(suffix)) {
            continue;
        }
        const response = await cache.match(request);
        if (!response) {
            continue;
        }
        const buffer = await response.arrayBuffer();
        result.push({
            path: videoPath + ".part" + suffix,
            index: Number(suffix),
            buffer: buffer
        });
    }
    result.sort(
        (a, b) => a.index - b.index);
    console.log("[SW] Video parçaları:", result.map(part => part.path));
    return result;
}

function parseRange(rangeHeader, totalSize) {
    if (!rangeHeader.startsWith("bytes=")) {
        return null;
    }
    const value = rangeHeader.slice(6);
    if (value.includes(",")) {
        return null;
    }
    const pieces = value.split("-");
    if (pieces.length !== 2) {
        return null;
    }
    const startText = pieces[0].trim();
    const endText = pieces[1].trim();
    let start;
    let end;
    if (startText === "") {
        const suffixLength = Number(endText);
        if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
            return null;
        }
        start = Math.max(0, totalSize - suffixLength);
        end = totalSize - 1;
    } else {
        start = Number(startText);
        if (!Number.isFinite(start) || start < 0) {
            return null;
        }
        if (endText === "") {
            end = totalSize - 1;
        } else {
            end = Number(endText);
            if (!Number.isFinite(end)) {
                return null;
            }
        }
    }
    if (start >= totalSize) {
        return null;
    }
    if (end >= totalSize) {
        end = totalSize - 1;
    }
    if (end < start) {
        return null;
    }
    return {
        start: start,
        end: end
    };
}

function combineVideoParts(parts, requestedStart, requestedEnd) {
    const outputLength = requestedEnd - requestedStart + 1;
    const output = new Uint8Array(outputLength);
    let outputOffset = 0;
    let fileOffset = 0;
    for (const part of parts) {
        const partBuffer = new Uint8Array(part.buffer);
        const partStart = fileOffset;
        const partEnd = fileOffset + partBuffer.byteLength - 1;
        if (partEnd < requestedStart) {
            fileOffset += partBuffer.byteLength;
            continue;
        }
        if (partStart > requestedEnd) {
            break;
        }
        const copyStart = Math.max(requestedStart, partStart);
        const copyEnd = Math.min(requestedEnd, partEnd);
        const sourceOffset = copyStart - partStart;
        const copyLength = copyEnd - copyStart + 1;
        output.set(partBuffer.subarray(sourceOffset, sourceOffset + copyLength), outputOffset);
        outputOffset += copyLength;
        fileOffset += partBuffer.byteLength;
        if (copyEnd >= requestedEnd) {
            break;
        }
    }
    return output;
}

function encodeLessonPath(path) {
    return path.split("/").map(part => encodeURIComponent(part)).join("/");
}

function getContentType(pathname) {
    const lower = pathname.toLowerCase();
    if (lower.endsWith(".html") || lower.endsWith(".htm")) {
        return "text/html; charset=utf-8";
    }
    if (lower.endsWith(".css")) {
        return "text/css; charset=utf-8";
    }
    if (lower.endsWith(".js") || lower.endsWith(".mjs")) {
        return "application/javascript";
    }
    if (lower.endsWith(".json")) {
        return "application/json";
    }
    if (lower.endsWith(".xml")) {
        return "application/xml";
    }
    if (lower.endsWith(".svg")) {
        return "image/svg+xml";
    }
    if (lower.endsWith(".png")) {
        return "image/png";
    }
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
        return "image/jpeg";
    }
    if (lower.endsWith(".gif")) {
        return "image/gif";
    }
    if (lower.endsWith(".webp")) {
        return "image/webp";
    }
    if (lower.endsWith(".ico")) {
        return "image/x-icon";
    }
    if (lower.endsWith(".woff")) {
        return "font/woff";
    }
    if (lower.endsWith(".woff2")) {
        return "font/woff2";
    }
    if (lower.endsWith(".ttf")) {
        return "font/ttf";
    }
    if (lower.endsWith(".eot")) {
        return "application/vnd.ms-fontobject";
    }
    if (lower.endsWith(".mp4")) {
        return "video/mp4";
    }
    if (lower.endsWith(".webm")) {
        return "video/webm";
    }
    if (lower.match(/\.mp4\.part\d+$/)) {
        return "application/octet-stream";
    }
    if (lower.match(/\.webm\.part\d+$/)) {
        return "application/octet-stream";
    }
    return "application/octet-stream";
}