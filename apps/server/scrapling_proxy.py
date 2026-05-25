#!/usr/bin/env python3
"""Cloudflare-bypassing proxy using curl_cffi for TLS fingerprinting."""
import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = int(os.environ.get('SCRAPLING_PROXY_PORT', '3002'))

# Try curl_cffi first (best Cloudflare bypass)
try:
    from curl_cffi import requests as curl_requests
    HAS_CURL = True
except ImportError:
    HAS_CURL = False

# Fallback to httpx
try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False


class ProxyHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body)
            url = data.get('url', '')
        except Exception:
            self._json(400, {'success': False, 'error': 'invalid JSON'})
            return

        if not url:
            self._json(400, {'success': False, 'error': 'url required'})
            return

        html = self._fetch(url)
        self._json(200, {'success': True, 'html': html})

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(b'cf-proxy running\n')
        self.wfile.write(f'curl_cffi: {HAS_CURL}, httpx: {HAS_HTTPX}\n'.encode())

    def _fetch(self, url: str) -> str:
        if HAS_CURL:
            try:
                r = curl_requests.get(
                    url,
                    impersonate='chrome124',
                    timeout=30,
                    headers={
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                        'Accept': 'text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5',
                    },
                )
                return r.text
            except Exception as e:
                print(f'[cf-proxy] curl_cffi failed: {e}', file=sys.stderr)

        if HAS_HTTPX:
            try:
                r = httpx.get(url, timeout=30, follow_redirects=True)
                return r.text
            except Exception as e:
                print(f'[cf-proxy] httpx failed: {e}', file=sys.stderr)

        return ''

    def _json(self, status: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f'[cf-proxy] {args[0]} {args[1]} {args[2]}')


if __name__ == '__main__':
    print(f'[cf-proxy] Starting on port {PORT} (curl_cffi: {HAS_CURL}, httpx: {HAS_HTTPX})')
    server = HTTPServer(('0.0.0.0', PORT), ProxyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
