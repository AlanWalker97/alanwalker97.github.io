const CACHE_NAME = "bbb-video-v1";

// ======================================================
// GITHUB AYARLARI
// ======================================================

let githubOwner = null;
let githubRepo = null;
let githubToken = null;

// ======================================================
// DESTEKLENEN MEDYA DOSYALARI
// ======================================================

const MEDIA_FILES = [

    "video/webcams.mp4",

    "video/webcams.webm",

    "deskshare/deskshare.mp4",

    "deskshare/deskshare.webm"

];

// ======================================================
// INSTALL
// ======================================================

self.addEventListener("install", event => {

    console.log(
        "[SW] Installed"
    );

    self.skipWaiting();

});

// ======================================================
// ACTIVATE
// ======================================================

self.addEventListener("activate", event => {

    console.log(
        "[SW] Activated"
    );

    event.waitUntil(
        self.clients.claim()
    );

});

// ======================================================
// INDEX'TEN GELEN MESAJLAR
// ======================================================

self.addEventListener("message", event => {

    // ==================================================
    // GITHUB CONFIG
    // ==================================================

    if (
        event.data?.type ===
        "SET_GITHUB_CONFIG"
    ) {

        githubOwner =
            event.data.owner;

        githubRepo =
            event.data.repo;

        githubToken =
            event.data.token;

        console.log(
            "[SW] GitHub ayarları alındı:",
            githubOwner,
            githubRepo
        );

        return;
    }

    // ==================================================
    // CACHE VIDEO
    // ==================================================

    if (
        event.data?.type !==
        "CACHE_VIDEO"
    ) {
        return;
    }

    const lessonUrl =
        event.data.url;

    const port =
        event.ports[0];

    console.log(
        "[SW] Ders medya cacheleme başladı:",
        lessonUrl
    );

    event.waitUntil(

        cacheLessonMedia(
            lessonUrl
        )

        .then(() => {

            console.log(
                "[SW] Ders medya cacheleme tamamlandı."
            );

            if (port) {

                port.postMessage({

                    type:
                        "CACHE_COMPLETE"

                });

            }

        })

        .catch(error => {

            console.error(
                "[SW] Cache hatası:",
                error
            );

            if (port) {

                port.postMessage({

                    type:
                        "CACHE_ERROR",

                    error:
                        error.message

                });

            }

        })

    );

});

// ======================================================
// GITHUB API URL
// ======================================================

function getGitHubApiUrl(filePath) {

    // ==================================================
    // CONFIG KONTROLÜ
    // ==================================================

    if (
        !githubOwner ||
        !githubRepo ||
        !githubToken
    ) {

        throw new Error(
            "GitHub ayarları Service Worker'a gönderilmemiş."
        );

    }

    // ==================================================
    // BAŞTAKİ / KARAKTERİNİ KALDIR
    // ==================================================

    const cleanPath =
        filePath.replace(
            /^\/+/,
            ""
        );

    // ==================================================
    // PATH'İ ENCODE ET
    // ==================================================

    const encodedPath = cleanPath;

    // ==================================================
    // GITHUB CONTENTS API
    // ==================================================

    return (
        "https://api.github.com/repos/" +
        encodeURIComponent(githubOwner) +
        "/" +
        encodeURIComponent(githubRepo) +
        "/contents/" +
        encodedPath +
        "?ref=main"
    );

}

// ======================================================
// GITHUB'DAN MEDYA PARÇASI İNDİR
// ======================================================

async function fetchGitHubPart(partUrl) {

    // ==================================================
    // PART PATH
    // ==================================================

    const githubPath =
        partUrl.replace(/^\/+/, "");

    // ==================================================
    // GITHUB API URL
    // ==================================================

    const apiUrl =
        getGitHubApiUrl(githubPath);

    console.log(
        "[SW] GitHub isteği:",
        githubPath
    );

    // ==================================================
    // GITHUB REQUEST
    // ==================================================

    const response =
        await fetch(
            apiUrl,
            {
                headers: {
                    "Accept":
                        "application/vnd.github.raw+json",

                    "Authorization":
                        `Bearer ${githubToken}`,

                    "X-GitHub-Api-Version":
                        "2026-03-10"
                }
            }
        );

    // ==================================================
    // 404 = PART YOK
    // ==================================================

    if (response.status === 404) {
        return null;
    }

    // ==================================================
    // GERÇEK HATA
    // ==================================================

    if (!response.ok) {

        let errorText = "";

        try {
            errorText =
                await response.text();
        } catch (_) {
            errorText = "";
        }

        throw new Error(
            `GitHub API hatası: ${response.status}` +
            (
                errorText
                    ? ` - ${errorText}`
                    : ""
            )
        );
    }

    // ==================================================
    // BAŞARILI
    // ==================================================

    return response;
}

// ======================================================
// DERSİN TÜM MEDYALARINI CACHE'LE
// ======================================================

async function cacheLessonMedia(
    lessonUrl
) {

    for (
        const mediaPath
        of MEDIA_FILES
    ) {

        const videoUrl =
            new URL(

                mediaPath,

                new URL(
                    lessonUrl,
                    self.location.origin
                )

            ).pathname;

        console.log(
            "[SW] Medya kontrol ediliyor:",
            videoUrl
        );

        await cacheMediaParts(
            videoUrl
        );

    }

}

// ======================================================
// TEK BİR MEDYANIN PARÇALARINI CACHE'E AL
// ======================================================

async function cacheMediaParts(
    mediaUrl
) {

    const cache =
        await caches.open(
            CACHE_NAME
        );

    let foundPart = false;

    // ==================================================
    // PART'LARI SIRAYLA DENE
    // ==================================================

    for (
        let i = 0;
        ;
        i++
    ) {

        const partUrl =
            mediaUrl +
            ".part" +
            String(i).padStart(
                3,
                "0"
            );

        // ==================================================
        // CACHE'DE VAR MI?
        // ==================================================

        const existing =
            await cache.match(
                partUrl
            );

        if (existing) {

            foundPart = true;

            console.log(
                "[SW] Zaten cache'de:",
                partUrl
            );

            continue;

        }

        // ==================================================
        // GITHUB'DAN İNDİR
        // ==================================================

        console.log(
            "[SW] GitHub'dan indiriliyor:",
            partUrl
        );

        const response =
            await fetchGitHubPart(
                partUrl
            );

        // ==================================================
        // PART YOK
        // ==================================================

        if (
            response === null
        ) {

            if (!foundPart) {

                console.log(
                    "[SW] Medya bulunamadı, atlanıyor:",
                    mediaUrl
                );

            } else {

                console.log(
                    "[SW] Son parça bulundu, cacheleme tamamlandı:",
                    partUrl
                );

            }

            break;

        }

        // ==================================================
        // CACHE'E KOY
        // ==================================================

        await cache.put(
            partUrl,
            response
        );

        foundPart = true;

        console.log(
            "[SW] Cache'lendi:",
            partUrl
        );

    }

}

// ======================================================
// MEDYA İSTEĞİNİ YAKALA
// ======================================================

self.addEventListener(
    "fetch",
    event => {

        const request =
            event.request;

        const url =
            new URL(
                request.url
            );

        // ==================================================
        // DESTEKLENEN MEDYA MI?
        // ==================================================

        const isSupportedMedia =
            MEDIA_FILES.some(
                mediaPath =>
                    url.pathname.endsWith(
                        "/" + mediaPath
                    )
            );

        if (
            !isSupportedMedia
        ) {
            return;
        }

        console.log(
            "[SW] MEDIA:",
            request.method,
            request.url,
            "Range:",
            request.headers.get(
                "range"
            )
        );

        event.respondWith(
            handleMediaRequest(
                request
            )
        );

    }
);

// ======================================================
// MEDYA → PARÇALARDAN OLUŞTUR
// ======================================================

async function handleMediaRequest(
    request
) {

    const cache =
        await caches.open(
            CACHE_NAME
        );

    const mediaUrl =
        new URL(
            request.url
        ).href;

    const pathname =
        new URL(
            request.url
        ).pathname;

    const range =
        request.headers.get(
            "range"
        );

    console.log(
        "[SW] MEDIA RANGE:",
        range
    );

    // ==================================================
    // HEAD
    // ==================================================

    if (
        request.method ===
        "HEAD"
    ) {

        const totalSize =
            await getMediaSize(
                cache,
                mediaUrl
            );

        if (
            totalSize === 0
        ) {

            return new Response(
                null,
                {
                    status: 404
                }
            );

        }

        return new Response(
            null,
            {

                status: 200,

                headers: {

                    "Content-Type":
                        getContentType(
                            pathname
                        ),

                    "Content-Length":
                        String(
                            totalSize
                        ),

                    "Accept-Ranges":
                        "bytes"

                }

            }
        );

    }

    // ==================================================
    // RANGE YOK
    // ==================================================

    if (!range) {

        console.log(
            "[SW] ⚠️ RANGE YOK:",
            request.url
        );

        return new Response(
            null,
            {

                status: 200,

                headers: {

                    "Content-Type":
                        getContentType(
                            pathname
                        ),

                    "Accept-Ranges":
                        "bytes",

                    "Content-Length":
                        "0"

                }

            }
        );

    }

    // ==================================================
    // RANGE PARSE
    // ==================================================

    const match =
        range.match(
            /bytes=(\d+)-(\d*)/
        );

    if (!match) {

        return new Response(
            "Invalid Range",
            {
                status: 416
            }
        );

    }

    const start =
        Number(
            match[1]
        );

    const requestedEnd =
        match[2]
            ? Number(match[2])
            : null;

    // ==================================================
    // CACHE'DEKİ PARÇALARI BUL
    // ==================================================

    const parts = [];

    let totalSize = 0;

    for (
        let i = 0;
        ;
        i++
    ) {

        const partUrl =
            mediaUrl +
            ".part" +
            String(i).padStart(
                3,
                "0"
            );

        const response =
            await cache.match(
                partUrl
            );

        if (!response) {
            break;
        }

        const buffer =
            await response.arrayBuffer();

        parts.push({

            buffer: buffer,

            start: totalSize,

            end:
                totalSize +
                buffer.byteLength -
                1

        });

        totalSize +=
            buffer.byteLength;

    }

    // ==================================================
    // HİÇ PARÇA YOK
    // ==================================================

    if (
        parts.length === 0
    ) {

        console.error(
            "[SW] Cache'de medya parçaları yok:",
            mediaUrl
        );

        return new Response(
            "Medya parçaları cache'de yok",
            {
                status: 404
            }
        );

    }

    // ==================================================
    // END HESAPLA
    // ==================================================

    const end =
        requestedEnd !== null
            ? Math.min(
                requestedEnd,
                totalSize - 1
            )
            : totalSize - 1;

    // ==================================================
    // RANGE GEÇERSİZ
    // ==================================================

    if (
        start >= totalSize ||
        start > end
    ) {

        return new Response(
            null,
            {

                status: 416,

                headers: {

                    "Content-Range":
                        `bytes */${totalSize}`

                }

            }
        );

    }

    // ==================================================
    // İSTENEN BYTE'LARI PARÇALARDAN ÇIKAR
    // ==================================================

    const outputParts = [];

    for (
        const part
        of parts
    ) {

        if (
            part.end < start
        ) {
            continue;
        }

        if (
            part.start > end
        ) {
            break;
        }

        const sliceStart =
            Math.max(
                0,
                start -
                part.start
            );

        const sliceEnd =
            Math.min(
                part.buffer.byteLength,
                end -
                part.start +
                1
            );

        outputParts.push(

            new Uint8Array(

                part.buffer.slice(
                    sliceStart,
                    sliceEnd
                )

            )

        );

    }

    // ==================================================
    // OUTPUT OLUŞTUR
    // ==================================================

    const outputSize =
        outputParts.reduce(

            (sum, part) =>
                sum +
                part.byteLength,

            0

        );

    const output =
        new Uint8Array(
            outputSize
        );

    let offset = 0;

    for (
        const part
        of outputParts
    ) {

        output.set(
            part,
            offset
        );

        offset +=
            part.byteLength;

    }

    // ==================================================
    // 206 RESPONSE
    // ==================================================

    console.log(
        "[SW] 206:",
        start,
        "-",
        end,
        "/",
        totalSize
    );

    return new Response(
        output,
        {

            status: 206,

            headers: {

                "Content-Type":
                    getContentType(
                        pathname
                    ),

                "Content-Length":
                    String(
                        output.byteLength
                    ),

                "Content-Range":
                    `bytes ${start}-${end}/${totalSize}`,

                "Accept-Ranges":
                    "bytes"

            }

        }
    );

}

// ======================================================
// MEDYANIN TOPLAM BOYUTUNU BUL
// ======================================================

async function getMediaSize(
    cache,
    mediaUrl
) {

    let totalSize = 0;

    for (
        let i = 0;
        ;
        i++
    ) {

        const partUrl =
            mediaUrl +
            ".part" +
            String(i).padStart(
                3,
                "0"
            );

        const response =
            await cache.match(
                partUrl
            );

        if (!response) {
            break;
        }

        const buffer =
            await response.arrayBuffer();

        totalSize +=
            buffer.byteLength;

    }

    return totalSize;

}

// ======================================================
// CONTENT-TYPE
// ======================================================

function getContentType(
    pathname
) {

    if (
        pathname.endsWith(
            ".webm"
        )
    ) {

        return "video/webm";

    }

    if (
        pathname.endsWith(
            ".mp4"
        )
    ) {

        return "video/mp4";

    }

    return "application/octet-stream";

}