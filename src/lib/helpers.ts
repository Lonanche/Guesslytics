/**
 * Match current window location
 *
 * @example
 * // window.location.href = "https://www.imdb.com/title/tt0040725"
 * matchUrl("imdb.com")               // true
 * matchUrl(["imdb.com", "/title/"])  // true
 * matchUrls(["imdb.com", "/name/"])  // false
 */
export const matchUrl = (
    url: string | string[],
    locationItem = "href",
    isEncoded = false
) => {
    try {
        if (typeof url === "string") url = [url];
        let href = window?.location?.[locationItem];
        if (isEncoded) href = btoa(href);
        return url.every((url) => href?.includes(url));
    } catch (error) {
        console.error("matchUrl", error);
        return false;
    }
};

/**
 * Match ALL urls with current window location
 *
 * @example
 * // window.location.href = "https://www.imdb.com/title/tt0030341"
 * matchUrls(["imdb.com", "/title/"])               // true
 * matchUrls(["imdb.com", "/name/"])                // false
 * matchUrls(["imdb.com", "/title/", "/tt0033467"]) // false
 */
export const matchUrls = (
    urls: (string | string[])[],
    locationItem = "href",
    isEncoded = false
) => {
    return urls.some((url) => matchUrl(url, locationItem, isEncoded));
};

export const select = (selector: string) => {
    return document.querySelector(selector);
};

export const selectAll = (selector: string) => {
    return document.querySelectorAll(selector);
};
