import http.server
import webbrowser
import os
import sys

try:
    from RangeHTTPServer import RangeRequestHandler
except ImportError:
    print("RangeHTTPServer bulunamadi, yukleniyor...")
    os.system(f'"{sys.executable}" -m pip install RangeHTTPServer')
    from RangeHTTPServer import RangeRequestHandler

PORT = 8000

server = http.server.HTTPServer(('', PORT), RangeRequestHandler)
print(f"Sunucu baslatildi: http://localhost:{PORT}")
print("Kapatmak icin bu pencereyi kapatiniz.")

webbrowser.open_new(f'http://localhost:{PORT}/index.html')

try:
    server.serve_forever()
except KeyboardInterrupt:
    print("\nSunucu kapatildi.")
