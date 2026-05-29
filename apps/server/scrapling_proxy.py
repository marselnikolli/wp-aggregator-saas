#!/usr/bin/env python3
"""Scrapling-based adaptive scraper for Mediadesk CMS and Cloudflare-bypass proxy."""
import json
import os
import re
import sys
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, urljoin

PORT = int(os.environ.get('SCRAPLING_PROXY_PORT', '3002'))

# ---------------------------------------------------------------------------
# Fetch backends — tried in order of preference
# ---------------------------------------------------------------------------

HAS_CURL = False
HAS_SCRAPLING = False
HAS_HTTPX = False

try:
    from curl_cffi import requests as curl_requests
    HAS_CURL = True
except ImportError:
    pass

try:
    from scrapling.parser import Selector
    HAS_SCRAPLING = True
except ImportError:
    pass

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    pass


def fetch_url(url: str, timeout: int = 45) -> str:
    """Fetch a URL, trying backends from most- to least-capable."""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
    }

    if HAS_CURL:
        try:
            r = curl_requests.get(url, impersonate='chrome124', timeout=timeout, headers=headers)
            return r.text
        except Exception as e:
            print(f'[scrapling] curl_cffi failed for {url}: {e}', file=sys.stderr)

    if HAS_HTTPX:
        try:
            r = httpx.get(url, timeout=timeout, follow_redirects=True, headers=headers)
            return r.text
        except Exception as e:
            print(f'[scrapling] httpx failed for {url}: {e}', file=sys.stderr)

    return ''


# ---------------------------------------------------------------------------
# Adaptive parsing helpers (via Scrapling Selector or fallback regex)
# ---------------------------------------------------------------------------

def _base(url: str) -> str:
    p = urlparse(url)
    return f'{p.scheme}://{p.netloc}'


def _abs(href: str, base_url: str) -> str:
    if not href:
        return ''
    if href.startswith('http'):
        return href
    return urljoin(base_url, href)


def parse_listing(html: str, listing_url: str) -> list[dict]:
    """Parse article cards from a listing page using adaptive strategies."""
    if not html:
        return []

    items = []
    base = _base(listing_url)

    if HAS_SCRAPLING:
        items = _parse_via_scrapling(html, base)
    else:
        items = _parse_via_regex(html, base)

    return items


def _parse_via_scrapling(html: str, base: str) -> list[dict]:
    """Adaptive parsing using Scrapling's Selector with multiple strategies."""
    from scrapling.parser import Selector

    page = Selector(html)
    items = []

    # Find card containers
    nav = None
    for sel in [
        'article.a-card', 'article.card', 'div.card',
        'div.post-card', 'div.article-card',
        'article',
        '.a-card', '.card', '.post', '.item', '.entry',
    ]:
        n = page.css(sel)
        if n and len(n):
            nav = n
            break

    if not nav:
        return []

    for i in range(len(nav)):
        card = nav[i]

        title = ''
        for heading_sel in ['h1, h2, h3, h4, h5, h6', 'a[href]']:
            h_el = card.css(heading_sel).first
            if h_el is not None:
                t = h_el.get().strip()
                if len(t) > 10:
                    title = t
                    break

        if not title:
            continue

        href = ''
        a_el = card.css('a[href]').first
        if a_el is not None:
            h = a_el.attrib.get('href', '')
            if h and not h.startswith('#') and not h.startswith('javascript:'):
                href = _abs(h, base)

        img_el = card.css('img').first
        image_url = ''
        if img_el is not None:
            image_url = img_el.attrib.get('data-src', '') or img_el.attrib.get('src', '')
            if image_url:
                image_url = _abs(image_url, base)

        category = ''
        for cat_sel in ['span', 'a', '.cat', '.category', '.section']:
            for el in card.css(cat_sel):
                t = el.get().strip()
                if t and len(t) < 40:
                    category = t
                    break
            if category:
                break

        item_id = ''
        if href:
            m = re.search(r'-i(\d+)', href)
            if m:
                item_id = m.group(1)

        items.append({
            'title': title,
            'url': href,
            'image': image_url,
            'category': category,
            'id': item_id,
            'content': '',
            'excerpt': '',
        })

    return items


def _parse_via_regex(html: str, base: str) -> list[dict]:
    """Fallback regex-based parsing when Scrapling is not available."""
    items = []

    # Match <article> blocks first
    article_pattern = re.compile(
        r'<article[^>]*class="[^"]*a-card[^"]*"(.*?)</article>',
        re.IGNORECASE | re.DOTALL,
    )
    for match in article_pattern.finditer(html):
        block = match.group(1)

        title_m = re.search(r'<h2[^>]*class="[^"]*a-head[^"]*">(.*?)</h2>', block, re.IGNORECASE | re.DOTALL)
        title = ''
        if title_m:
            title = re.sub(r'<[^>]+>', '', title_m.group(1)).strip()

        if not title:
            continue

        href_m = re.search(r'<a[^>]*href="([^"]+)"', block, re.IGNORECASE)
        href = _abs(href_m.group(1), base) if href_m else ''

        img_m = re.search(r'<img[^>]*(?:data-src|src)="([^"]+)"', block, re.IGNORECASE)
        image_url = _abs(img_m.group(1), base) if img_m else ''
        if not image_url:
            img_m = re.search(r'data-src="([^"]+)"', block)
            image_url = _abs(img_m.group(1), base) if img_m else ''

        cat_m = re.search(r'<span[^>]*class="[^"]*a-cat[^"]*">(.*?)</span>', block, re.IGNORECASE)
        category = cat_m.group(1).strip() if cat_m else ''

        item_id = ''
        if href:
            m = re.search(r'-i(\d+)', href)
            item_id = m.group(1) if m else ''

        items.append({
            'title': title,
            'url': href,
            'image': image_url,
            'category': category,
            'id': item_id,
            'content': '',
            'excerpt': '',
        })

    return items


def parse_article(html: str, article_url: str) -> dict:
    """Extract full article content from a page using adaptive strategies."""
    if not html:
        return {'content': '', 'excerpt': '', 'imageUrl': None}

    if HAS_SCRAPLING:
        return _parse_article_scrapling(html, article_url)
    else:
        return _parse_article_regex(html, article_url)


def _parse_article_scrapling(html: str, article_url: str) -> dict:
    """Adaptive article content extraction via Scrapling."""
    from scrapling.parser import Selector
    page = Selector(html)

    def nav_attr(nav, attr):
        """Get attribute from first element of a navigator."""
        if nav is not None:
            first = nav.first
            if first is not None:
                return first.attrib.get(attr, '')
        return ''

    def nav_text(nav):
        """Get text from first element of a navigator."""
        if nav is not None:
            first = nav.first
            if first is not None:
                return first.get().strip()
        return ''

    # OG image
    og_image = (
        nav_attr(page.css('meta[property="og:image"]'), 'content')
        or nav_attr(page.css('meta[name="twitter:image"]'), 'content')
        or nav_attr(page.css('meta[property="og:image:url"]'), 'content')
        or ''
    )
    if og_image:
        og_image = _abs(og_image, article_url)

    # Try content selectors in priority order
    content_html = ''
    content_selectors = [
        '.a-full-content', '.all-content',
        '[itemprop="articleBody"]',
        '.article-content', '.post-content', '.entry-content',
        '.content', '.post-body', '.article-body',
        'main',
        '#content', '#article',
        'article',
    ]
    for sel in content_selectors:
        nav = page.css(sel)
        el = nav.first if nav else None
        if el is not None:
            text = el.get_all_text().strip()
            if len(text) > 100:
                content_html = el.extract()
                # If we didn't get og:image, try first img in content
                if not og_image:
                    img_el = el.css('img[src]').first
                    if img_el is not None:
                        s = img_el.attrib.get('src', '')
                        if s and not s.startswith('data:'):
                            og_image = _abs(s, article_url)
                break

    # Fallback: use body with noisy elements removed
    if not content_html:
        body_nav = page.css('body')
        body = body_nav.first if body_nav else None
        if body is not None:
            for bad_sel in ['script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside', '.sidebar', '.menu', '.comments', 'iframe', 'form']:
                for bad in body.css(bad_sel):
                    bad.remove()
            txt = body.get_all_text().strip()
            if len(txt) > 100:
                content_html = body.extract()

    # Excerpt from meta description or first 300 chars
    excerpt = nav_attr(page.css('meta[name="description"]'), 'content')
    if not excerpt:
        body_nav = page.css('body')
        body = body_nav.first if body_nav else None
        if body is not None:
            text = body.get_all_text().strip()
            excerpt = text[:300]

    return {'content': content_html, 'excerpt': excerpt, 'imageUrl': og_image}


def _parse_article_regex(html: str, article_url: str) -> dict:
    """Fallback regex-based article extraction."""
    og_image = ''
    m = re.search(r'<meta[^>]*property="og:image"[^>]*content="([^"]+)"', html, re.IGNORECASE)
    if m:
        og_image = _abs(m.group(1), article_url)
    if not og_image:
        m = re.search(r'<meta[^>]*name="twitter:image"[^>]*content="([^"]+)"', html, re.IGNORECASE)
        if m:
            og_image = _abs(m.group(1), article_url)

    content = ''
    # Try to find content between common content containers
    for cls in ['a-full-content', 'all-content', 'article-content', 'post-content', 'entry-content', 'content', 'article-body']:
        m = re.search(
            rf'<div[^>]*class="[^"]*{cls}[^"]*">(.*?)</div>\s*(?:</div>|</section>|</article>)',
            html, re.IGNORECASE | re.DOTALL,
        )
        if m:
            content = m.group(1).strip()
            break

    if not content:
        m = re.search(r'<article[^>]*>(.*?)</article>', html, re.IGNORECASE | re.DOTALL)
        if m:
            content = m.group(1).strip()

    excerpt = ''
    m = re.search(r'<meta[^>]*name="description"[^>]*content="([^"]+)"', html, re.IGNORECASE)
    if m:
        excerpt = m.group(1)
    if not excerpt and content:
        excerpt = re.sub(r'<[^>]+>', '', content)[:300]

    return {'content': content, 'excerpt': excerpt, 'imageUrl': og_image}


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class ScraplingHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body)
        except Exception:
            return self._json(400, {'success': False, 'error': 'invalid JSON'})

        action = data.get('action', 'fetch')
        url = data.get('url', '')

        if not url:
            return self._json(400, {'success': False, 'error': 'url required'})

        try:
            if action == 'fetch':
                html = fetch_url(url)
                return self._json(200, {'success': True, 'html': html})

            elif action == 'parse_listing':
                html = fetch_url(url)
                items = parse_listing(html, url)
                return self._json(200, {'success': True, 'items': items, 'html': html if data.get('returnHtml') else ''})

            elif action == 'parse_article':
                html = fetch_url(url)
                result = parse_article(html, url)
                return self._json(200, {'success': True, **result})

            else:
                return self._json(400, {'success': False, 'error': f'unknown action: {action}'})

        except Exception as e:
            print(f'[scrapling] Error processing {action} {url}: {e}', file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            return self._json(500, {'success': False, 'error': str(e)})

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        status = f'scrapling proxy running\ncurl_cffi: {HAS_CURL}, scrapling: {HAS_SCRAPLING}, httpx: {HAS_HTTPX}\n'
        self.wfile.write(status.encode())

    def _json(self, status: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f'[scrapling] {args[0]} {args[1]} {args[2]}')


if __name__ == '__main__':
    print(f'[scrapling] Starting on port {PORT}')
    print(f'[scrapling] curl_cffi={HAS_CURL} scrapling={HAS_SCRAPLING} httpx={HAS_HTTPX}')
    server = HTTPServer(('0.0.0.0', PORT), ScraplingHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
