import express, { response } from "express";
import cookieParser from "cookie-parser";
import bodyParser from "body-parser";
import url from "url";
import puppeteer, { BrowserContext, Page } from "puppeteer";
import { body, oneOf } from "express-validator";
import path from "path";

const server = express();
const port = 3117;

const defaultUrl = "https://www.google.com/";
const defaultViewportWidth = 1024;
const pageKeepaliveTimeout = 1000 * 60 * 60;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function testRenderingAPage(url: string, viewportWidth: number, wait = 5000) {
    const testBrowser = await puppeteer.launch();
    const page = await testBrowser.newPage();

    await page.setViewport({
        width: viewportWidth,
        height: 1024,
    });
    await page.goto(url);
    await sleep(wait);
    const screenshot = page.screenshot({
        type: "jpeg",
        captureBeyondViewport: true,
        fullPage: true,
    });

    screenshot.finally(() => {
        testBrowser.close();
    });

    return screenshot;
}

server.get('/test', async (req, res) => {
    const url = req.query["url"];
    const width = req.query["width"] ?? "1024";
    const wait = req.query["wait"] ?? "5000";

    const widthPx = parseInt("" + width);
    const waitMs = parseInt("" + wait);

    const renderedImage = await testRenderingAPage("" + url, widthPx, waitMs);
    res.contentType("jpeg");
    await res.send(renderedImage);
    return;

});

const browser = puppeteer.launch();

type TimeoutHandle = ReturnType<typeof setTimeout>;

type UserSession = {
    context: Promise<BrowserContext>;
    pages: Record<string, {
        page: Promise<Page>,
        /**
         * A handle to this page's keepalive timer. Whenever the user interacts with this page, this timeout should be cancelled and rescheduled.
         */
        timeout: TimeoutHandle,
        /**
         * If another operation is in progress for this page, and we should wait for it to complete, it will be saved here.
         */
        waiting: Promise<unknown>,
    }>;
}

const userSessions: Record<string, UserSession> = {};
let userIdIncr = 0;
function generateUserId() {
    return (userIdIncr++) + "";
}
let pageIdIncr = 0;
function generatePageId() {
    return (pageIdIncr++) + "";
}

server.use(cookieParser());

// middleware for creating user sessions and managing cookies
const userIdCookieKey = "userId";
server.use((req, res, next) => {
    const userIdCookie = req.cookies[userIdCookieKey];
    if (!userIdCookie || typeof userIdCookie !== "string" || !(userSessions[userIdCookie])) {
        const newUserId = generateUserId();
        userSessions[newUserId] = {
            context: browser.then(b => (b.createBrowserContext())),
            pages: {}
        };
        req.cookies[userIdCookieKey] = newUserId;
        res.cookie(userIdCookieKey, newUserId);
    }
    next();
});

// root, handle cookies, serve up starter page
server.get('/', async (req, res) => {
    res.sendFile(path.join(__dirname, "../static/start.html"));
});

async function setupPage(page: Page | Promise<Page>, startUrl: string, viewportWidth: string) {
    const p = page instanceof Promise ? (await page) : page;
    const vw = viewportWidth ? parseInt(viewportWidth) : defaultViewportWidth;
    await p.setViewport({
        width: vw,
        height: 1024
    });
    if (startUrl) {
        await p.goto(startUrl);
    }
    return;
}

const PARAM_VIEWPORT_WIDTH = "viewportWidth";
const PARAM_START_URL = "startUrl";

server.post('/pages/',
    express.urlencoded(),
    oneOf([body(PARAM_START_URL).isEmpty(), body(PARAM_START_URL).isURL()]),
    oneOf([body(PARAM_VIEWPORT_WIDTH).isEmpty(), body(PARAM_VIEWPORT_WIDTH).isInt({
        min: 64,
        max: 65535
    })]),
    async (req, res) => {
        const userSession = userSessions[req.cookies[userIdCookieKey]];
        if (!userSession) {
            res.sendStatus(500);
            return;
        }

        const pageId = generatePageId();
        const page = userSession.context.then(context => context.newPage());


        const viewportWidth = req.body["viewportWidth"];
        const startUrl = req.body["startUrl"];

        const waiting: Promise<unknown> = setupPage(page, startUrl, viewportWidth);

        userSession.pages[pageId] = {
            page,
            timeout: setTimeout(() => {
                page.then(p => p.close());
            }, pageKeepaliveTimeout),
            waiting
        };

        res.redirect(`/pages/${pageId}/`);
    });

const FORMATS_TO_CONTENTTYPES = {
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
};

const CLICK_COORDINATES_REGEX = new RegExp("^(\\d+),(\\d+)$");

function getRawQueryString(url: string) {
    const qmark = url.indexOf("?");
    if (qmark >= 0) {
        return url.substring(qmark + 1);
    } else {
        return "";
    }
}

server.get('/pages/:pageId/', async (req, res) => {
    const page = (userSessions[req.cookies[userIdCookieKey]].pages[req.params.pageId]);
    if (!page) {
        res.sendStatus(404);
        return;
    } else {
        // image map sends coordinates here too, for lols
        const rawQuery = getRawQueryString(req.originalUrl);

        if (rawQuery) {
            const match = CLICK_COORDINATES_REGEX.exec(rawQuery);
            if (match) {
                const x = parseInt(match[1]);
                const y = parseInt(match[2]);
                await page.waiting;
                const waitPromise = createResolvablePromise();
                page.waiting = waitPromise.promise;
                try {
                    await (await page.page).mouse.click(x, y);
                } finally {
                    waitPromise.resolve(null);
                }
            }
        }
        res.sendFile(path.join(__dirname, "../static/page.html"));
    }
});

server.get('/pages/:pageId/viewport.:ext', async (req, res) => {
    const extension = req.params.ext.toLowerCase();
    if (!["jpg", "jpeg", "png", "webp"].includes(extension)) {
        res.sendStatus(404);
        return;
    }
    const format = (extension === "jpg" ? "jpeg" : extension) as "jpeg" | "png" | "webp";

    const page = userSessions[req.cookies[userIdCookieKey]].pages[req.params.pageId];
    if (!page) {
        res.sendStatus(404);
        return;
    }

    const screenshot = await (await page.page).screenshot({
        captureBeyondViewport: true,
        fullPage: true,
        optimizeForSpeed: true,
        type: format,
        quality: format === "png" ? undefined : 95,
    });

    res.statusCode = 200;
    res.contentType(FORMATS_TO_CONTENTTYPES[format]);
    res.setHeader("cache-control", "no-cache");
    res.send(screenshot);
});

type ClickEvent = {
    type: "click",
    x: number,
    y: number,
}

type InputEvent = ClickEvent;

function parseInputEvent(request: string): InputEvent {
    if (!request) throw new Error();
    const parsedEvent = JSON.parse(request) as InputEvent;
    if (parsedEvent.type === "click") {
        if (typeof parsedEvent.x !== "number" || parsedEvent.x < 0 ||
            typeof parsedEvent.y !== "number" || parsedEvent.y < 0) {
            throw new Error();
        } else {
            return parsedEvent;
        }
    }

    throw new Error();
}

/**
 * Helper function for creating an arbitrary Promise that can be resolved externally.
 */
function createResolvablePromise<V>() {
    let resolution = "pending" as "pending" | "done" | "error";
    let value = null as V | null;
    let error = null as any | null;

    let handlers = {
        resolve: (v: V) => {
            if (resolution === "pending") {
                resolution = "done";
                value = v;
            }
        },
        reject: (e?: any) => {
            if (resolution === "pending") {
                resolution = "error";
                error = e;
            }
        }
    };

    const promise = new Promise((res, rej) => {
        if (resolution === "done") {
            res(value);
        } else if (resolution === "error") {
            rej(error);
        } else {
            handlers.resolve = res;
            handlers.reject = rej;
        }
    });

    return {
        promise,
        resolve: (v?: V) => handlers.resolve(v),
        reject: (e?: any) => handlers.reject(e),
    }
}

// server.post('/pages/:pageId/input', async (req, res) => {

//     let inputEvent: InputEvent;

//     try {
//         inputEvent = parseInputEvent(req.body);
//     } catch (e) {
//         res.sendStatus(400);
//         return;
//     }

//     const page = userSessions[req.cookies[userIdCookieKey]].pages[req.params.pageId];
//     if (!page) {
//         res.sendStatus(404);
//         return;
//     }

//     switch (inputEvent.type) {
//         case "click": {
//             if (page.waiting) await page.waiting;
//             const p = createResolvablePromise();
//             page.waiting = p.promise;
//             try {
//                 const mouse = (await page.page).mouse;
//                 await mouse.click(inputEvent.x, inputEvent.y);
//                 res.sendStatus(200);
//                 return;
//             }
//             finally {
//                 p.resolve(null);
//             }
//         }
//         default: {
//             res.sendStatus(400);
//             return;
//         }
//     }
// });

server.listen(port);