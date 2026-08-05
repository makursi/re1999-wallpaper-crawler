# Network-first capture for wallpaper discovery

We capture image URLs from network responses (`page.on("response")` matching
`content-type: image/*`) rather than scanning the DOM. The DOM only drives
scrolling, clicks, and hash injection. DOM-only counting was tried first and
failed: the SPA uses virtual scroll that unmounts off-screen images, so the
discoverable count never stabilizes and discovery never converges. Network
listening records a request the moment it happens, regardless of whether the
element stays in the DOM.
