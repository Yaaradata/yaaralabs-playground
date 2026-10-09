"""Download an image from a link a student pasted, for image-recognition projects.

Pasted links are often not direct image files: a Google/Bing image-search result, a
web page that shows the picture, a 'data:' URL from "Copy image address" on a search
thumbnail, or a server that sends the wrong Content-Type. This resolves those cases to
the actual image bytes, and otherwise raises ImageUrlError with a message a student
can act on.
"""
import base64
import binascii
import io
import logging
import uuid
from html.parser import HTMLParser
from typing import Optional, Tuple
from urllib.parse import parse_qs, unquote, urljoin, urlparse

import aiohttp
from PIL import Image

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_PAGE_BYTES = 3 * 1024 * 1024

# Formats stored as-is; anything else Pillow can read is converted to JPEG
_KEEP_FORMATS = {"JPEG": ("image/jpeg", "jpg"), "PNG": ("image/png", "png"),
                 "GIF": ("image/gif", "gif"), "WEBP": ("image/webp", "webp")}

# Identify honestly first (sites like Wikimedia reject a browser User-Agent sent from a
# non-browser client); if refused, retry once looking like a browser, which some CDNs require.
_ACCEPT = "image/webp,image/png,image/jpeg,image/*;q=0.9,text/html;q=0.8,*/*;q=0.5"
_HEADER_SETS = [
    {"User-Agent": "YaaraLabsPlayground/1.0 (https://yaaralabs.ai; fetches a user-pasted image link)",
     "Accept": _ACCEPT},
    {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
     "Accept": _ACCEPT},
]

NOT_AN_IMAGE_HELP = (
    "That link opens a web page, not an image. Right-click the picture itself, "
    "choose 'Copy image address', and paste that link instead."
)


class ImageUrlError(Exception):
    """A problem with the pasted link, safe to show to the user."""


class _PageImageFinder(HTMLParser):
    """Finds the main image a web page declares (og:image, twitter:image, image_src)."""

    def __init__(self):
        super().__init__()
        self.candidates = []

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key in ("og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"):
                self.candidates.append(a.get("content", ""))
        elif tag == "link" and "image_src" in a.get("rel", "").lower():
            self.candidates.append(a.get("href", ""))


def _unwrap_search_link(url: str) -> str:
    """Google/Bing image-search result links carry the real image URL in a parameter."""
    params = parse_qs(urlparse(url).query)
    for key in ("imgurl", "mediaurl"):
        value = params.get(key, [""])[0]
        if value.startswith(("http://", "https://")):
            logger.info(f"Using image URL from search-result link parameter '{key}'")
            return value
    return url


def _decode_image(data: bytes) -> Optional[Tuple[bytes, str, str]]:
    """Return (bytes, content_type, extension) if data is an image Pillow can read."""
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception:
        return None
    if img.format in _KEEP_FORMATS:
        content_type, ext = _KEEP_FORMATS[img.format]
        return data, content_type, ext
    # e.g. BMP, TIFF, ICO: store as JPEG so the rest of the pipeline sees a common format
    out = io.BytesIO()
    img.convert("RGB").save(out, "JPEG", quality=92)
    return out.getvalue(), "image/jpeg", "jpg"


def _decode_data_url(url: str) -> Tuple[bytes, str, str]:
    header, _, payload = url.partition(",")
    if not header.startswith("data:image/") or not payload:
        raise ImageUrlError("This 'data:' link doesn't contain an image.")
    try:
        data = base64.b64decode(payload) if ";base64" in header else unquote(payload).encode("latin-1")
    except (binascii.Error, ValueError):
        raise ImageUrlError("This 'data:' image link is damaged. Try copying the image address again.")
    if len(data) > MAX_IMAGE_BYTES:
        raise ImageUrlError("Image is too large. Maximum size is 10MB.")
    decoded = _decode_image(data)
    if not decoded:
        raise ImageUrlError("This 'data:' link doesn't contain a readable image.")
    return decoded


async def _get(session: aiohttp.ClientSession, url: str, limit: int) -> Tuple[bytes, str, str]:
    """GET url, returning (body, content_type, final_url). Body is capped at limit + 1 bytes."""
    status = None
    for headers in _HEADER_SETS:
        async with session.get(url, headers=headers, allow_redirects=True) as response:
            status = response.status
            if status == 200:
                # read(n) returns whatever is buffered, so loop until EOF or past the limit
                chunks, size = [], 0
                async for chunk in response.content.iter_chunked(64 * 1024):
                    chunks.append(chunk)
                    size += len(chunk)
                    if size > limit:
                        break
                body = b"".join(chunks)
                return body, response.headers.get("content-type", ""), str(response.url)
            if status not in (401, 403, 429):
                break
    if status in (401, 403, 429):
        raise ImageUrlError(
            f"The website blocked the download (HTTP {status}). "
            "Try a different image link, or save the picture and upload it as a file."
        )
    if status == 404:
        raise ImageUrlError("Image not found at that link (HTTP 404). Check the link and try again.")
    raise ImageUrlError(f"Failed to download image from URL. HTTP {status}")


async def fetch_image_from_url(image_url: str) -> Tuple[bytes, str, str]:
    """Download the image a pasted link points to.

    Returns (image_bytes, content_type, filename). Raises ImageUrlError with a
    user-facing message when the link can't be turned into an image.
    """
    url = (image_url or "").strip()
    if url.startswith("data:"):
        data, content_type, ext = _decode_data_url(url)
        return data, content_type, f"image_{uuid.uuid4().hex[:8]}.{ext}"
    if not url.startswith(("http://", "https://")):
        raise ImageUrlError("Invalid URL format. Must start with http:// or https://")

    url = _unwrap_search_link(url)
    timeout = aiohttp.ClientTimeout(total=30)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            body, content_type, final_url = await _get(session, url, MAX_IMAGE_BYTES)
            if len(body) > MAX_IMAGE_BYTES and "html" not in content_type.lower():
                raise ImageUrlError("Image is too large. Maximum size is 10MB.")
            decoded = _decode_image(body)

            if not decoded:
                looks_like_page = "html" in content_type.lower() or body.lstrip()[:1] == b"<"
                if not looks_like_page and content_type.lower().startswith("image/"):
                    raise ImageUrlError(
                        f"The image at that link couldn't be read ('{content_type}'). "
                        "Only JPEG, PNG, GIF, and WebP images are allowed."
                    )
                if not looks_like_page:
                    raise ImageUrlError(
                        f"The link didn't return an image (it returned '{content_type or 'unknown content'}'). "
                        "Only JPEG, PNG, GIF, and WebP images are allowed."
                    )
                # A web page: follow the main image it declares (one hop only)
                finder = _PageImageFinder()
                finder.feed(body[:MAX_PAGE_BYTES].decode("utf-8", errors="ignore"))
                candidates = [urljoin(final_url, c.strip()) for c in finder.candidates if c.strip()]
                for candidate in candidates[:3]:
                    if not candidate.startswith(("http://", "https://")):
                        continue
                    logger.info(f"Link was a web page; trying its declared image {candidate}")
                    try:
                        body, _, final_url = await _get(session, candidate, MAX_IMAGE_BYTES)
                    except (ImageUrlError, aiohttp.ClientError):
                        continue
                    if len(body) > MAX_IMAGE_BYTES:
                        raise ImageUrlError("Image is too large. Maximum size is 10MB.")
                    decoded = _decode_image(body)
                    if decoded:
                        break
                if not decoded:
                    raise ImageUrlError(NOT_AN_IMAGE_HELP)
    except aiohttp.ClientError as e:
        raise ImageUrlError(f"Failed to download image from URL: {e}")
    except TimeoutError:
        raise ImageUrlError("Timeout while downloading image from URL")

    data, content_type, ext = decoded
    if len(data) > MAX_IMAGE_BYTES:
        raise ImageUrlError("Image is too large. Maximum size is 10MB.")

    # Name from the URL path, made safe for a storage path, plus a short id so two
    # different images that are both called e.g. 'image.jpg' don't overwrite each other
    stem = urlparse(final_url).path.rstrip("/").split("/")[-1].rsplit(".", 1)[0]
    stem = "".join(ch for ch in unquote(stem) if ch.isalnum() or ch in "-_")[:60] or "image"
    return data, content_type, f"{stem}_{uuid.uuid4().hex[:8]}.{ext}"
