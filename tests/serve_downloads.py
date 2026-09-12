"""Read-only CORS file server for the test corpus (user's Downloads folder)."""
import http.server, functools, sys
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a): pass
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8772
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(H, directory='C:/Users/rakoo/Downloads')).serve_forever()
