const mangayomiSources = [{
    "name": "Rawkuma",
    "lang": "ja",
    "baseUrl": "https://rawkuma.net",
    "apiUrl": "",
    "iconUrl": "https://www.google.com/s2/favicons?sz=128&domain=https://rawkuma.net",
    "typeSource": "single",
    "itemType": 0,
    "isManga": true,
    "isNsfw": true,
    "version": "1.0.0",
    "dateFormat": "",
    "dateFormatLocale": ""
}];

class DefaultExtension extends MProvider {
    constructor() { super(); this.client = new Client(); }
    getHeaders(url) { return { "Referer": `${this.source.baseUrl}/` }; }
    absoluteUrl(url) { return url.startsWith("http") ? url : `${this.source.baseUrl}/${url.replace(/^\//, "")}`; }
    async mangaList(url) {
        const res = await this.client.get(url, this.getHeaders(url));
        const doc = new Document(res.body), list = [], seen = {};
        for (const item of doc.select("a[href]")) {
            const link = item.getHref;
            if (!link || !link.includes("/manga/") || link.includes("/chapter-")) continue;
            const image = item.selectFirst("img[alt]");
            const name = image?.attr("alt").trim(), imageUrl = image?.getSrc;
            if (name && imageUrl && !seen[link]) { seen[link] = true; list.push({ name, imageUrl, link }); }
        }
        return { list, hasNextPage: doc.selectFirst("a:contains(Next)") != null };
    }
    async getPopular(page) { return this.mangaList(`${this.source.baseUrl}/latest-update/?the_page=${page}`); }
    async getLatestUpdates(page) { return this.mangaList(`${this.source.baseUrl}/latest-update/?the_page=${page}`); }
    async search(query, page, filters) {
        if (!query.trim()) return this.getLatestUpdates(page);
        const home = await this.client.get(this.source.baseUrl, this.getHeaders(this.source.baseUrl));
        const endpoint = new Document(home.body).selectFirst("form[hx-post*='action=search']")?.attr("hx-post");
        if (!endpoint) return { list: [], hasNextPage: false };
        const res = await this.client.post(this.absoluteUrl(endpoint), this.getHeaders(endpoint), { query });
        const list = [];
        for (const item of new Document(res.body).select("a[href*='/manga/']")) {
            const image = item.selectFirst("img[alt]"), name = image?.attr("alt").trim(), imageUrl = image?.getSrc, link = item.getHref;
            if (name && imageUrl && link) list.push({ name, imageUrl, link });
        }
        return { list, hasNextPage: false };
    }
    statusCode(status) {
        return ({ "ongoing": 0, "completed": 1, "complete": 1, "hiatus": 2, "canceled": 3, "cancelled": 3 })[(status || "").toLowerCase()] ?? 5;
    }
    async getDetail(url) {
        const mangaUrl = this.absoluteUrl(url), res = await this.client.get(mangaUrl, this.getHeaders(mangaUrl)), doc = new Document(res.body);
        let metadata = {};
        for (const script of doc.select("script[type='application/ld+json']")) {
            try { const data = JSON.parse(script.text); if (data["@type"] === "Book" || (data["@type"] || []).includes("Book")) { metadata = data; break; } } catch (_) {}
        }
        const chapters = [], seen = {};
        for (const item of doc.select("a[href]")) {
            const chapterUrl = item.getHref;
            if (!chapterUrl || !chapterUrl.includes("/chapter-") || seen[chapterUrl]) continue;
            const name = item.selectFirst("span")?.text.trim() || item.text.trim().replace(/\s+(\d+\s*(minutes|hours|days|weeks|months|years) ago).*$/i, "");
            const dateText = item.selectFirst("time")?.attr("datetime");
            if (name) { seen[chapterUrl] = true; chapters.push({ name, url: chapterUrl, dateUpload: dateText ? String(new Date(dateText).valueOf()) : null }); }
        }
        return { imageUrl: metadata.image?.url || doc.selectFirst("img.wp-post-image")?.getSrc, description: metadata.description || "", author: metadata.author?.name || "", genre: metadata.genre || [], status: this.statusCode(metadata.creativeWorkStatus), chapters };
    }
    async getPageList(url) {
        const chapterUrl = this.absoluteUrl(url), res = await this.client.get(chapterUrl, this.getHeaders(chapterUrl)), pages = [];
        for (const image of new Document(res.body).select("img[src]")) {
            const imageUrl = image.getSrc;
            if (imageUrl && imageUrl.includes("kuma.kyut.dev/wp-content/scr/")) pages.push({ url: imageUrl, headers: this.getHeaders(imageUrl) });
        }
        return pages;
    }
}
