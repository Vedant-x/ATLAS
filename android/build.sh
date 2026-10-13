#!/usr/bin/env bash
# Builds ATLAS.apk with the Android SDK's own tools (aapt2, javac, d8, zipalign, apksigner): no Gradle,
# no libraries. Uses the newest platform and build-tools installed (GitHub's Ubuntu runners have them).
#   VERSION_CODE   integer, higher for each release (default 1)
#   KEYSTORE_B64   base64 PKCS12 keystore to sign with (+ KEYSTORE_PASS, KEY_ALIAS); without it a new
#                  key is made for this build
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -d "$SDK" ] || { echo "Android SDK not found (set ANDROID_HOME)"; exit 1; }
BT="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
PLATFORM="$(ls "$SDK/platforms" | grep -E '^android-[0-9]+$' | sort -t- -k2 -n | tail -1)"
API="${PLATFORM#android-}"
JAR="$SDK/platforms/$PLATFORM/android.jar"
VC="${VERSION_CODE:-1}"
echo "build-tools $(basename "$BT"), $PLATFORM, version $VC"

OUT=build
rm -rf "$OUT" && mkdir -p "$OUT/classes" "$OUT/dex" "$OUT/gen"
cp -r res "$OUT/res"
mkdir -p "$OUT/res/mipmap-xxxhdpi" "$OUT/res/drawable-nodpi"
cp ../icons/icon-192.png "$OUT/res/mipmap-xxxhdpi/ic_launcher.png"
cp ../icons/icon-maskable-512.png "$OUT/res/drawable-nodpi/icon_maskable.png"
cp ../icons/badge-96.png "$OUT/res/drawable-nodpi/ic_badge.png"

"$BT/aapt2" compile --dir "$OUT/res" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$JAR" --manifest AndroidManifest.xml \
  --min-sdk-version 24 --target-sdk-version "$API" --version-code "$VC" --version-name "1.$VC" \
  --java "$OUT/gen" "$OUT/res.zip"
javac -encoding UTF-8 --release 11 -classpath "$JAR" -d "$OUT/classes" $(find src "$OUT/gen" -name '*.java')
"$BT/d8" --release --min-api 24 --lib "$JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
(cd "$OUT/dex" && zip -q ../base.apk classes.dex)
"$BT/zipalign" -p -f 4 "$OUT/base.apk" "$OUT/aligned.apk"

KS="$OUT/key.p12"
if [ -n "${KEYSTORE_B64:-}" ]; then
  echo "$KEYSTORE_B64" | base64 -d > "$KS"
else
  echo "No KEYSTORE_B64: signing with a new key"
  KEYSTORE_PASS="$(head -c 18 /dev/urandom | base64)"; KEY_ALIAS=atlas
  keytool -genkeypair -keystore "$KS" -storetype PKCS12 -storepass "$KEYSTORE_PASS" -keypass "$KEYSTORE_PASS" \
    -alias "$KEY_ALIAS" -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=ATLAS" >/dev/null
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass "pass:$KEYSTORE_PASS" --ks-key-alias "${KEY_ALIAS:-atlas}" --out ATLAS.apk "$OUT/aligned.apk"
"$BT/apksigner" verify --print-certs ATLAS.apk | head -3
rm -f "$KS"
ls -l ATLAS.apk
