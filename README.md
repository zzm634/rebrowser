# rebrowser
A hosted web browser instance you can use from ancient hardware.

## Purpose
Many of us have old and underpowered devices that used to be able to browse the web, but can't anymore. Root certificates expire, Javascript adds new features, or modern pages just get too damn bloated. If you can't upgrade the hardware or the software, what can you do?

Well, whatever device you have can probably still display an image and record some click events, right? How about a remote web browser for that? It may not be responsive, but if all you want to do is show the weather forecast on your Dell Axim from 2003, maybe this will be good enough.

Sorta like an extremely-lightweight VNC client that can run on a punch-card loom.

## Server/Client

The server will use Puppeteer to render pages for clients, keeping track of user sessions, cookies, etc. The clients will access the server through a very basic web page consisting entirely of a single image (the rendered page from the server), and barely enough javascript to capture mouse clicks and send them back to the server for rendering.

## Roadmap

Initial support will target touch devices like the Nintendo 3DS, and Kindle e-readers. This means a single rendered image and mouse click events only. That should be enough for the majority of use cases where one might want to use an old device like this.

Future:
* Mouse move events for hover-menus
* Keyboard input
* File downloads
* Video streaming (rather than jpegs)