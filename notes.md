# Implementation notes (for me)

## Sessions

Use a cookie to identify unique clients. Store user session data remotely (like their actual cookies, cached stuff, history, etc.). When a client connects, get their session ready, but don't load up a page yet

## Paths

Home page is per user. Has a form with fields that lets them start a new session, like: starting URL, page width, format, etc. Also has links to any other currently running pages for this user.

New tabs are started by making a GET request to `/new` with query options:
* url=<starting page url>
* width=<viewport width in pixels>
* etc.

Server responds with a redirect once their new session has been started. The location will be `/<unique key>/` which will return the HTML page they need to draw the client.

The current rendered view of the page will be at `/<unique key>/viewport.[png|jpg|webp]`. The view image will always be sent back with headers that try to prevent the clients from caching the images. The clients will also add a "cache breaker" query to their image requests, by adding a `?<n>` to their requests that constantly increments.

Clients will send user interactions back with a POST request to `/<unique key>/input`. The interaction should be encoded in JSON for the server to handle.
