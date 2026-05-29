#!/bin/sh
set -eu

cert_name="${LETSENCRYPT_CERT_NAME:-aiswatch.live}"
cert_dir="/etc/letsencrypt/live/$cert_name"
output="/etc/nginx/tls/ssl-certificate.conf"

mkdir -p /etc/nginx/tls

if [ -s "$cert_dir/fullchain.pem" ] && [ -s "$cert_dir/privkey.pem" ]; then
  cat > "$output" <<EOF
ssl_certificate $cert_dir/fullchain.pem;
ssl_certificate_key $cert_dir/privkey.pem;
EOF
  echo "Using Let's Encrypt certificate named $cert_name"
else
  cat > "$output" <<'EOF'
ssl_certificate /etc/nginx/bootstrap/fullchain.pem;
ssl_certificate_key /etc/nginx/bootstrap/privkey.pem;
EOF
  echo "Using bootstrap self-signed certificate until Let's Encrypt certs exist"
fi
