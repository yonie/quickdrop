#!/bin/sh
# Refresh the browser libraries in public/vendor from the npm registry.
# Needs only curl and tar. Change a version below, run this, rebuild.
set -eu

PDFJS=6.5.438        # pdfjs-dist: PDF thumbnails, preview, PDF to PNG (Apache-2.0)
ZIPJS=2.25.0         # @zip.js/zip.js: Zip module (BSD-3-Clause)
LAMEJS=1.2.7         # @breezystack/lamejs: MP3 encoding in Convert (LGPL-3.0)

ROOT=$(cd "$(dirname "$0")/.." && pwd)
VENDOR="$ROOT/public/vendor"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

fetch() { # fetch <package> <tarball name> <version> <dir>
  mkdir -p "$WORK/$4"
  curl -fsSL "https://registry.npmjs.org/$1/-/$2-$3.tgz" | tar -xz -C "$WORK/$4" --strip-components=1
}

fetch pdfjs-dist pdfjs-dist "$PDFJS" pdfjs
fetch @zip.js/zip.js zip.js "$ZIPJS" zip
fetch @breezystack/lamejs lamejs "$LAMEJS" lamejs

rm -rf "$VENDOR"
mkdir -p "$VENDOR/pdfjs" "$VENDOR/zip" "$VENDOR/lamejs"
cp "$WORK"/pdfjs/build/pdf.min.mjs "$WORK"/pdfjs/build/pdf.worker.min.mjs \
   "$WORK"/pdfjs/build/pdf.renderer.min.mjs "$WORK"/pdfjs/build/pdf.sandbox.min.mjs \
   "$WORK"/pdfjs/LICENSE "$VENDOR/pdfjs/"
cp "$WORK/zip/index.min.js" "$VENDOR/zip/zip.min.js"
cp "$WORK/zip/LICENSE" "$VENDOR/zip/"
cp "$WORK/lamejs/dist/lamejs.js" "$WORK/lamejs/LICENSE" "$VENDOR/lamejs/"

du -sh "$VENDOR"
