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
    "version": "2.0.0",
    "dateFormat": "",
    "dateFormatLocale": ""
}];

// Debug flag: when true, advancedSearch() throws the raw admin-ajax.php response
// instead of parsing it, so it surfaces in the app's error UI without needing a
// network log. Kept here (off) for future troubleshooting -- flip to true if
// getPopular/getLatestUpdates/search ever return an empty list unexpectedly again.
const DEBUG = false;
const DEBUG_FILTERS = false;

class DefaultExtension extends MProvider {
    constructor() { super(); this.client = new Client(); }
    getHeaders(url) { return { "Referer": `${this.source.baseUrl}/` }; }
    absoluteUrl(url) { return url.startsWith("http") ? url : `${this.source.baseUrl}/${url.replace(/^\//, "")}`; }

    // ---- Unified listing/search/filter, all backed by the same WordPress AJAX
    // endpoint the site itself uses to power /library/ (browse+sort+filter+search).
    // Discovered via DevTools Network capture: POST to admin-ajax.php?action=advanced_search
    // with a WP nonce (fetched from admin-ajax.php?type=search_form&action=get_nonce --
    // NOT present in /library/'s raw HTML, since the filter panel and nonce are
    // injected client-side by JS after page load) and a multipart body of
    // {genre, genre_exclude, type, status, author, artist} as JSON-array-encoded
    // strings, plus {page, order, orderby, query, project, inclusion, exclusion}.
    // The response is an HTML fragment of manga cards + a page-number pagination
    // block, swapped into #search-results via htmx.
    async advancedSearch(page, params = {}) {
        // The nonce is NOT present in /library/'s raw server-rendered HTML -- it's
        // injected into the DOM by client-side JS after page load. The actual
        // source is this dedicated GET endpoint (found via Network tab), which
        // returns a tiny HTML snippet: <input type='hidden' name='search_nonce' value='...'>
        const nonceEndpoint = `${this.source.baseUrl}/wp-admin/admin-ajax.php?type=search_form&action=get_nonce`;
        const nonceRes = await this.client.get(nonceEndpoint, this.getHeaders(nonceEndpoint));
        const nonceBody = nonceRes.body || "";
        const nonce = new Document(nonceBody).selectFirst("input[name='search_nonce']")?.attr("value");
        if (DEBUG && !nonce) {
            throw new Error(`DEBUG nonce-not-found status=${nonceRes.statusCode} bodyLen=${nonceBody.length} snippet=${JSON.stringify(nonceBody.slice(0, 400))}`);
        }
        if (!nonce) return { list: [], hasNextPage: false };
        const body = {
            nonce, page: String(page), query: params.query || "",
            inclusion: params.inclusion || "OR", exclusion: params.exclusion || "OR", project: "0",
            genre: JSON.stringify(params.genre || []), genre_exclude: JSON.stringify(params.genreExclude || []),
            type: JSON.stringify(params.type || []), status: JSON.stringify(params.status || []),
            author: JSON.stringify(params.author || []), artist: JSON.stringify(params.artist || []),
            order: params.order || "desc", orderby: params.orderby || "popular",
        };
        const endpoint = `${this.source.baseUrl}/wp-admin/admin-ajax.php?action=advanced_search`;
        const res = await this.client.post(endpoint, this.getHeaders(endpoint), body);
        if (DEBUG) {
            const bodyText = res.body || "";
            throw new Error(`DEBUG status=${res.statusCode} headers=${JSON.stringify(res.headers || {})} bodyLen=${bodyText.length} snippet=${JSON.stringify(bodyText.slice(0, 400))}`);
        }
        return this.parseSearchResults(res.body, page);
    }

    parseSearchResults(html, page) {
        // Each result renders twice in the fragment (a horizontal-mode card and a
        // grid-mode card, toggled via CSS depending on view mode), but both wrap
        // the manga link around img.wp-post-image, so de-duping by href picks the
        // first occurrence and naturally skips the title-only <a> (no image) and
        // the per-chapter <a> links (no img.wp-post-image) without extra filtering.
        const doc = new Document(html), list = [], seen = {};
        for (const link of doc.select("a[href*='/manga/']")) {
            const href = link.getHref;
            if (!href || seen[href]) continue;
            const img = link.selectFirst("img.wp-post-image");
            if (!img) continue;
            const name = img.attr("alt")?.trim(), imageUrl = img.getSrc;
            if (name && imageUrl) { seen[href] = true; list.push({ name, imageUrl, link: href }); }
        }
        // Pagination buttons are labelled with their literal page number (e.g. "2",
        // "3"); the trailing "next" arrow button has no text (SVG only) so it's
        // dropped by the isNaN filter automatically.
        const pageNums = doc.select("button").map(b => parseInt((b.text || "").trim(), 10)).filter(n => !isNaN(n));
        return { list, hasNextPage: pageNums.some(n => n > page) };
    }

    async getPopular(page) { return this.advancedSearch(page, { orderby: "popular", order: "desc" }); }
    async getLatestUpdates(page) { return this.advancedSearch(page, { orderby: "updated", order: "desc" }); }

    getFilterList() {
        // Extracted from the /library/ filter panel (#nav-filter) via DevTools.
        // [slug, label] pairs for Genre were captured directly from #genre-filter's
        // data-genre attributes (via a console script scrolling the virtualized
        // list). Kept as explicit pairs -- not re-derived from the label -- because
        // the site's own data has a duplicate label with distinct slugs
        // ("thriller" / "thriller-2", both labelled "Thriller"). Type and Status
        // were short enough to render in full without virtualization.
        const genrePairs = [["action", "Action"], ["adaptions", "Adaptions"], ["adult", "Adult"], ["adventure", "Adventure"],
            ["animals", "Animals"], ["comedy", "Comedy"], ["crime", "Crime"], ["drama", "Drama"], ["ecchi", "Ecchi"],
            ["fantasy", "Fantasy"], ["game", "Game"], ["gender-bender", "Gender Bender"], ["girls-love", "Girls' Love"],
            ["harem", "Harem"], ["hentai", "Hentai"], ["historical", "Historical"], ["horror", "Horror"], ["isekai", "isekai"],
            ["josei", "Josei"], ["lolicon", "Lolicon"], ["magic", "magic"], ["martial-arts", "Martial Arts"], ["mature", "Mature"],
            ["mecha", "Mecha"], ["mystery", "Mystery"], ["oneshot", "Oneshot"], ["philosophical", "Philosophical"],
            ["police", "Police"], ["psychological", "Psychological"], ["romance", "Romance"], ["school-life", "School Life"],
            ["sci-fi", "Sci-fi"], ["seinen", "Seinen"], ["shotacon", "Shotacon"], ["shoujo", "Shoujo"], ["shoujo-ai", "Shoujo Ai"],
            ["shounen", "Shounen"], ["shounen-ai", "Shounen Ai"], ["slice-of-life", "Slice of Life"], ["smut", "Smut"],
            ["sports", "Sports"], ["supernatural", "Supernatural"], ["thriller", "Thriller"], ["thriller-2", "Thriller"],
            ["tragedy", "Tragedy"], ["yaoi", "Yaoi"], ["yuri", "Yuri"]];
        const triStatePair = ([value, name]) => ({ type_name: "TriState", name, value, state: 0 });
        const triState = (name) => triStatePair([name.toLowerCase().replace(/\s+/g, "-"), name]);
        // SortFilter.values must be an array of filter-shaped objects (not plain
        // strings): the app's deserializer treats every values[] entry as a Map
        // and dispatches on type_name, so a raw string here throws and silently
        // wipes the *entire* filter list back to [] (this was the actual cause of
        // genre filtering doing nothing in Browse -- getFilterList() was crashing
        // on the sort values and the app was swallowing that into an empty list).
        const sortOption = (name) => ({ type_name: "SelectOption", name, value: name.toLowerCase() });
        return [
            { type_name: "GroupFilter", name: "Genre", state: genrePairs.map(triStatePair) },
            { type_name: "GroupFilter", name: "Type", state: ["Manga", "Manhua", "Manhwa", "Novel"].map(triState) },
            { type_name: "GroupFilter", name: "Status", state: ["Cancelled", "Completed", "On Hiatus", "Ongoing", "Unknown"].map(triState) },
            { type_name: "SortFilter", name: "Sort By", state: { index: 0, ascending: false, type_name: "SortState" }, values: ["Popular", "Rating", "Updated", "Bookmarked", "Title"].map(sortOption) },
        ];
    }

    async search(query, page, filters) {
        // filters arrives as the JSON-serialized state of getFilterList()'s
        // return value (TriState: 0=unused, 1=included, 2=excluded).
        if (DEBUG_FILTERS) {
            throw new Error(`DEBUG search() called with query=${JSON.stringify(query)} page=${page} filters=${JSON.stringify(filters)}`);
        }
        const params = { query, orderby: "popular", order: "desc" };
        for (const f of filters || []) {
            if (f.type_name === "GroupFilter") {
                const included = (f.state || []).filter(s => s.state === 1).map(s => s.value);
                const excluded = (f.state || []).filter(s => s.state === 2).map(s => s.value);
                if (f.name === "Genre") { params.genre = included; params.genreExclude = excluded; }
                else if (f.name === "Type") params.type = included;
                else if (f.name === "Status") params.status = included;
            } else if (f.type_name === "SortFilter" && f.name === "Sort By") {
                const sorts = ["popular", "rating", "updated", "bookmarked", "title"];
                params.orderby = sorts[f.state?.index ?? 0] || "popular";
                params.order = f.state?.ascending ? "asc" : "desc";
            }
        }
        return this.advancedSearch(page, params);
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
        // The site has migrated CDNs at least once (kuma.kyut.dev vs the legacy
        // rcdn.kyut.dev), and even within rcdn.kyut.dev the URL *path* shape is
        // inconsistent across chapters of the same manga, e.g.:
        //   rcdn.kyut.dev/images/k/kaoru-hana-wa-rin-to-saku/102/1.jpg
        //   rcdn.kyut.dev/k/kaoru-hana-wa-rin-to-saku/chapter-140/1.jpg
        // (no "/images/" prefix, "chapter-" prefix on the chapter number). Matching
        // on hostname alone instead of a fixed path is more robust to these path
        // variations; both hosts are dedicated page-image CDNs so this shouldn't
        // pick up unrelated images.
        const chapterUrl = this.absoluteUrl(url), res = await this.client.get(chapterUrl, this.getHeaders(chapterUrl)), pages = [];
        for (const image of new Document(res.body).select("img[src]")) {
            const imageUrl = image.getSrc;
            if (imageUrl && (imageUrl.includes("kuma.kyut.dev/") || imageUrl.includes("rcdn.kyut.dev/"))) {
                pages.push({ url: imageUrl, headers: this.getHeaders(imageUrl) });
            }
        }
        return pages;
    }
}
