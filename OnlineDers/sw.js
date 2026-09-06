// ======================================================
// GITHUB AYARLARI
// ======================================================

let githubOwner = null;
let githubRepo = null;
let githubToken = null;


// ======================================================
// AKTİF DERS
// ======================================================

// Örnek:
//
// currentLesson.path
// "15 DERSTE 5 NET SAYISAL YETENEK KAMPI - 1. DERS"
//
// currentLesson.files
// Map {
//     "index.html" -> ArrayBuffer,
//     "css/style.css" -> ArrayBuffer,
//     "js/player.js" -> ArrayBuffer,
//     ...
// }

let currentLesson = null;


// ======================================================
// INSTALL
// ======================================================

self.addEventListener("install", event => {

    console.log("[SW] Installed");

    self.skipWaiting();

});


// ======================================================
// ACTIVATE
// ======================================================

self.addEventListener("activate", event => {

    console.log("[SW] Activated");

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
    // DERS YÜKLE
    // ==================================================

    if (
        event.data?.type ===
        "LOAD_LESSON"
    ) {

        const lessonPath =
            event.data.lessonPath;

        const port =
            event.ports[0];


        console.log(
            "[SW] Ders yükleme başladı:",
            lessonPath
        );


        event.waitUntil(

            loadLesson(
                lessonPath
            )

            .then(() => {

                console.log(
                    "[SW] Ders RAM'e tamamen yüklendi:",
                    lessonPath
                );


                if (port) {

                    port.postMessage({

                        type:
                            "LESSON_READY"

                    });

                }

            })

            .catch(error => {

                console.error(
                    "[SW] Ders yükleme hatası:",
                    error
                );


                if (port) {

                    port.postMessage({

                        type:
                            "LESSON_ERROR",

                        error:
                            error.message

                    });

                }

            })

        );

    }

});


// ======================================================
// GITHUB API URL
// ======================================================

function getGitHubApiUrl(
    githubPath
) {

    if (
        !githubOwner ||
        !githubRepo ||
        !githubToken
    ) {

        throw new Error(
            "GitHub ayarları Service Worker'a gönderilmemiş."
        );

    }


    const cleanPath =
        githubPath.replace(
            /^\/+/,
            ""
        );


    const encodedPath =
        cleanPath
            .split("/")
            .map(
                part =>
                    encodeURIComponent(part)
            )
            .join("/");


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
// GITHUB API İSTEĞİ
// ======================================================

async function githubRequest(
    githubPath
) {

    const apiUrl =
        getGitHubApiUrl(
            githubPath
        );


    console.log(
        "[SW] GitHub:",
        githubPath
    );


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


    if (
        response.status ===
        404
    ) {

        return null;

    }


    if (!response.ok) {

        let errorText = "";


        try {

            errorText =
                await response.text();

        }
        catch (_) {

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


    return response;

}


// ======================================================
// DİZİN LİSTELE
// ======================================================

async function listGitHubDirectory(
    directoryPath
) {

    const apiUrl =
        getGitHubApiUrl(
            directoryPath
        );


    const response =
        await fetch(
            apiUrl,
            {
                headers: {

                    "Accept":
                        "application/vnd.github+json",

                    "Authorization":
                        `Bearer ${githubToken}`,

                    "X-GitHub-Api-Version":
                        "2026-03-10"

                }
            }
        );


    if (
        response.status ===
        404
    ) {

        throw new Error(
            "Ders klasörü GitHub'da bulunamadı:\n" +
            directoryPath
        );

    }


    if (!response.ok) {

        let errorText = "";


        try {

            errorText =
                await response.text();

        }
        catch (_) {

            errorText = "";

        }


        throw new Error(

            `GitHub klasör listeleme hatası: ${response.status}` +

            (
                errorText
                    ? ` - ${errorText}`
                    : ""
            )

        );

    }


    const data =
        await response.json();


    if (!Array.isArray(data)) {

        throw new Error(
            "GitHub'dan klasör listesi alınamadı."
        );

    }


    return data;

}


// ======================================================
// DERS KLASÖRÜNDEKİ TÜM DOSYALARI BUL
// ======================================================

async function findAllFiles(
    directoryPath
) {

    const entries =
        await listGitHubDirectory(
            directoryPath
        );


    const files = [];


    for (
        const entry
        of entries
    ) {

        // ----------------------------------------------
        // DOSYA
        // ----------------------------------------------

        if (
            entry.type ===
            "file"
        ) {

            files.push(
                entry.path
            );

            continue;

        }


        // ----------------------------------------------
        // KLASÖR
        // ----------------------------------------------

        if (
            entry.type ===
            "dir"
        ) {

            const subFiles =
                await findAllFiles(
                    entry.path
                );


            files.push(
                ...subFiles
            );

        }

    }


    return files;

}


// ======================================================
// DERSİ TAMAMEN RAM'E YÜKLE
// ======================================================

async function loadLesson(
    lessonPath
) {

    // ==================================================
    // GITHUB AYAR KONTROLÜ
    // ==================================================

    if (
        !githubOwner ||
        !githubRepo ||
        !githubToken
    ) {

        throw new Error(
            "GitHub ayarları hazır değil."
        );

    }


    // ==================================================
    // YOLU TEMİZLE
    // ==================================================

    const cleanLessonPath =
        lessonPath
            .replace(
                /^\/+/,
                ""
            )
            .replace(
                /\/+$/,
                ""
            );


    if (!cleanLessonPath) {

        throw new Error(
            "Geçersiz ders klasörü."
        );

    }


    console.log(
        "[SW] Ders klasörü:",
        cleanLessonPath
    );


    // ==================================================
    // ESKİ DERSİ HEMEN SİLME
    // ==================================================
    //
    // Yeni ders tamamen yüklenene kadar
    // eski ders RAM'de kalabilir.
    //
    // Yeni ders başarılı olunca aşağıda
    // currentLesson değiştirilecek.
    // ==================================================

    console.log(
        "[SW] Ders dosyaları keşfediliyor..."
    );


    // ==================================================
    // KLASÖRDEKİ TÜM DOSYALARI BUL
    // ==================================================

    const githubFiles =
        await findAllFiles(
            cleanLessonPath
        );


    console.log(
        "[SW] Bulunan dosya sayısı:",
        githubFiles.length
    );


    if (
        githubFiles.length ===
        0
    ) {

        throw new Error(
            "Ders klasörü boş."
        );

    }


    // ==================================================
    // YENİ RAM
    // ==================================================

    const newFiles =
        new Map();


    // ==================================================
    // TÜM DOSYALARI RAM'E AL
    // ==================================================

    for (
        let i = 0;
        i < githubFiles.length;
        i++
    ) {

        const githubFilePath =
            githubFiles[i];


        console.log(
            `[SW] Dosya ${i + 1}/${githubFiles.length}:`,
            githubFilePath
        );


        const response =
            await githubRequest(
                githubFilePath
            );


        if (!response) {

            throw new Error(
                "Dosya bulunamadı:\n" +
                githubFilePath
            );

        }


        const buffer =
            await response.arrayBuffer();


        // ----------------------------------------------
        // DERS KLASÖRÜNE GÖRE RELATIVE PATH
        // ----------------------------------------------

        let relativePath =
            githubFilePath.slice(
                cleanLessonPath.length
            );


        relativePath =
            relativePath.replace(
                /^\/+/,
                ""
            );


        // ----------------------------------------------
        // RAM'E KOY
        // ----------------------------------------------

        newFiles.set(
            relativePath,
            buffer
        );


        console.log(
            "[SW] RAM'e alındı:",
            relativePath,
            "(",
            buffer.byteLength,
            "bytes )"
        );

    }


    // ==================================================
    // INDEX.HTML VAR MI?
    // ==================================================

    if (
        !newFiles.has(
            "index.html"
        )
    ) {

        throw new Error(
            "Ders klasöründe index.html bulunamadı."
        );

    }


    // ==================================================
    // YENİ DERSİ AKTİF ET
    // ==================================================

    currentLesson = {

        path:
            cleanLessonPath,

        files:
            newFiles

    };


    console.log(
        "[SW] =================================="
    );

    console.log(
        "[SW] DERS RAM'E ALINDI"
    );

    console.log(
        "[SW] Klasör:",
        currentLesson.path
    );

    console.log(
        "[SW] Dosya sayısı:",
        currentLesson.files.size
    );

    console.log(
        "[SW] =================================="
    );

}


// ======================================================
// FETCH
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
        // DERS SAYFASI
        // ==================================================
        //
        // Tarayıcı:
        //
        // /dersizle.html
        //
        // istediğinde RAM'deki:
        //
        // index.html
        //
        // döndürülecek.
        // ==================================================

        if (
            url.pathname.endsWith(
                "/dersizle.html"
            ) ||
            url.pathname ===
                "/dersizle.html"
        ) {

            if (
                !currentLesson
            ) {

                return;

            }


            event.respondWith(
                serveLessonIndex()
            );


            return;

        }


        // ==================================================
        // AKTİF DERS RAM'DE DEĞİLSE
        // ==================================================

        if (
            !currentLesson
        ) {

            return;

        }


        // ==================================================
        // DERSİN VİRTÜEL ROOT YOLU
        // ==================================================

        const lessonRoot =
            "/" +
            encodeLessonPath(
                currentLesson.path
            );


        // ==================================================
        // URL DERS KLASÖRÜNÜN İÇİNDE Mİ?
        // ==================================================

        if (
            url.pathname ===
                lessonRoot ||

            url.pathname.startsWith(
                lessonRoot + "/"
            )
        ) {

            event.respondWith(
                serveLessonFile(
                    url.pathname
                )
            );

        }

    }
);


// ======================================================
// DERS INDEX.HTML SERVİSİ
// ======================================================

async function serveLessonIndex() {

    const buffer =
        currentLesson.files.get(
            "index.html"
        );


    if (!buffer) {

        return new Response(
            "Ders index.html bulunamadı.",
            {
                status: 404
            }
        );

    }


    // ==================================================
    // HTML'I UTF-8 OLARAK OKU
    // ==================================================

    const decoder =
        new TextDecoder(
            "utf-8"
        );


    let html =
        decoder.decode(
            buffer
        );


    // ==================================================
    // BASE HREF
    // ==================================================
    //
    // Çok önemli:
    //
    // Tarayıcı URL'si:
    //
    // /dersizle.html
    //
    // olduğu için HTML'in:
    //
    // css/style.css
    //
    // gibi relative yolları normalde:
    //
    // /css/style.css
    //
    // olarak çözümlenecekti.
    //
    // Burada base ekleyerek:
    //
    // /DERS_KLASORU/css/style.css
    //
    // yapılmasını sağlıyoruz.
    // ==================================================

    const baseHref =
        "/" +
        encodeLessonPath(
            currentLesson.path
        ) +
        "/";


    const baseTag =
        `<base href="${baseHref}">`;


    if (
        /<base\s/i.test(
            html
        )
    ) {

        html =
            html.replace(
                /<base\b[^>]*>/i,
                baseTag
            );

    }
    else {

        html =
            html.replace(
                /<head\b[^>]*>/i,
                match =>
                    match +
                    baseTag
            );

    }


    return new Response(
        html,
        {
            status: 200,

            headers: {

                "Content-Type":
                    "text/html; charset=utf-8"

            }

        }
    );

}


// ======================================================
// DERS DOSYASI SERVİSİ
// ======================================================

async function serveLessonFile(
    pathname
) {

    // ==================================================
    // URL'DEN VİRTÜEL DERS ROOT'UNU ÇIKAR
    // ==================================================

    const lessonRoot =
        "/" +
        encodeLessonPath(
            currentLesson.path
        );


    let relativePath =
        pathname.slice(
            lessonRoot.length
        );


    relativePath =
        decodeURIComponent(
            relativePath
        );


    relativePath =
        relativePath.replace(
            /^\/+/,
            ""
        );


    // ==================================================
    // TRAILING SLASH / INDEX
    // ==================================================

    if (
        !relativePath
    ) {

        relativePath =
            "index.html";

    }


    // ==================================================
    // RAM'DEN BUL
    // ==================================================

    const buffer =
        currentLesson.files.get(
            relativePath
        );


    if (!buffer) {

        console.error(
            "[SW] RAM'de dosya bulunamadı:",
            relativePath
        );


        return new Response(
            "Dosya RAM'de bulunamadı:\n" +
            relativePath,
            {
                status: 404
            }
        );

    }


    console.log(
        "[SW] RAM →",
        relativePath
    );


    return new Response(
        buffer,
        {
            status: 200,

            headers: {

                "Content-Type":
                    getContentType(
                        relativePath
                    ),

                "Content-Length":
                    String(
                        buffer.byteLength
                    )

            }

        }
    );

}


// ======================================================
// DERS PATH'İNİ URL PATH'E ÇEVİR
// ======================================================

function encodeLessonPath(
    path
) {

    return path
        .split("/")
        .map(
            part =>
                encodeURIComponent(part)
        )
        .join("/");

}


// ======================================================
// CONTENT TYPE
// ======================================================

function getContentType(
    pathname
) {

    const lower =
        pathname.toLowerCase();


    // HTML
    if (
        lower.endsWith(
            ".html"
        ) ||
        lower.endsWith(
            ".htm"
        )
    ) {

        return "text/html; charset=utf-8";

    }


    // CSS
    if (
        lower.endsWith(
            ".css"
        )
    ) {

        return "text/css; charset=utf-8";

    }


    // JavaScript
    if (
        lower.endsWith(
            ".js"
        ) ||
        lower.endsWith(
            ".mjs"
        )
    ) {

        return "application/javascript";

    }


    // JSON
    if (
        lower.endsWith(
            ".json"
        )
    ) {

        return "application/json";

    }


    // XML
    if (
        lower.endsWith(
            ".xml"
        )
    )
    {

        return "application/xml";

    }


    // SVG
    if (
        lower.endsWith(
            ".svg"
        )
    ) {

        return "image/svg+xml";

    }


    // PNG
    if (
        lower.endsWith(
            ".png"
        )
    ) {

        return "image/png";

    }


    // JPEG
    if (
        lower.endsWith(
            ".jpg"
        ) ||
        lower.endsWith(
            ".jpeg"
        )
    ) {

        return "image/jpeg";

    }


    // GIF
    if (
        lower.endsWith(
            ".gif"
        )
    ) {

        return "image/gif";

    }


    // WEBP
    if (
        lower.endsWith(
            ".webp"
        )
    ) {

        return "image/webp";

    }


    // ICO
    if (
        lower.endsWith(
            ".ico"
        )
    ) {

        return "image/x-icon";

    }


    // WOFF
    if (
        lower.endsWith(
            ".woff"
        )
    ) {

        return "font/woff";

    }


    // WOFF2
    if (
        lower.endsWith(
            ".woff2"
        )
    ) {

        return "font/woff2";

    }


    // TTF
    if (
        lower.endsWith(
            ".ttf"
        )
    ) {

        return "font/ttf";

    }


    // EOT
    if (
        lower.endsWith(
            ".eot"
        )
    ) {

        return "application/vnd.ms-fontobject";

    }


    // MP4
    if (
        lower.endsWith(
            ".mp4"
        )
    ) {

        return "video/mp4";

    }


    // WEBM
    if (
        lower.endsWith(
            ".webm"
        )
    ) {

        return "video/webm";

    }


    // MP4 PART
    if (
        lower.match(
            /\.mp4\.part\d+$/
        )
    ) {

        return "application/octet-stream";

    }


    // WEBM PART
    if (
        lower.match(
            /\.webm\.part\d+$/
        )
    ) {

        return "application/octet-stream";

    }


    // Varsayılan
    return "application/octet-stream";

}