#!/bin/sh
set -e

CERT_DIR="/data/certs"
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"
CONF_FILE="$CERT_DIR/openssl.cnf"
HASH_FILE="$CERT_DIR/base_url.hash"

# Create cert directory if it doesn't exist
mkdir -p "$CERT_DIR"

# Function to extract host from URL
extract_host() {
    echo "$1" | sed -E 's|^https?://||' | sed -E 's|:[0-9]+.*||' | sed -E 's|/.*||'
}

# Function to check if host is an IP address
is_ip() {
    echo "$1" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'
}

# Get BASE_URL from API (wait for API to be ready)
get_base_url() {
    for i in $(seq 1 30); do
        BASE_URL=$(wget -q -O- http://api:3005/api/settings/base-url 2>/dev/null | sed 's/.*"baseUrl":"\([^"]*\)".*/\1/' 2>/dev/null) || true
        if [ -n "$BASE_URL" ] && [ "$BASE_URL" != "null" ]; then
            echo "$BASE_URL"
            return 0
        fi
        echo "Waiting for API to provide BASE_URL... (attempt $i/30)" >&2
        sleep 2
    done
    # Fallback to environment variable or default
    echo "${BASE_URL:-https://localhost:3443}"
}

# Get the configured BASE_URL
BASE_URL=$(get_base_url)
echo "Using BASE_URL: $BASE_URL"

# Extract host from BASE_URL
HOST=$(extract_host "$BASE_URL")
echo "Extracted host: $HOST"

# Calculate hash of current BASE_URL to detect changes
CURRENT_HASH=$(echo "$BASE_URL" | md5sum | cut -d' ' -f1)

# Check if we need to regenerate certificate
NEED_REGEN=false
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
    NEED_REGEN=true
    echo "Certificate not found, generating..."
elif [ ! -f "$HASH_FILE" ]; then
    NEED_REGEN=true
    echo "BASE_URL hash not found, regenerating certificate..."
elif [ "$(cat "$HASH_FILE")" != "$CURRENT_HASH" ]; then
    NEED_REGEN=true
    echo "BASE_URL changed, regenerating certificate..."
fi

if [ "$NEED_REGEN" = true ]; then
    echo "Generating self-signed certificate for: $HOST"
    
    # Build SAN entries based on host type
    if is_ip "$HOST"; then
        # Host is an IP address
        SAN_ENTRIES="DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = $HOST"
    else
        # Host is a domain name
        SAN_ENTRIES="DNS.1 = localhost
DNS.2 = $HOST
IP.1 = 127.0.0.1"
    fi
    
    # Create OpenSSL config
    cat > "$CONF_FILE" << EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = $HOST

[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
subjectAltName = @alt_names

[alt_names]
$SAN_ENTRIES
EOF
    
    openssl req -x509 -newkey rsa:2048 \
        -keyout "$KEY_FILE" \
        -out "$CERT_FILE" \
        -days 365 \
        -nodes \
        -config "$CONF_FILE"
    
    # Save hash for change detection
    echo "$CURRENT_HASH" > "$HASH_FILE"
    
    echo "Certificate generated successfully for: $HOST"
else
    echo "Using existing certificate for: $HOST"
fi

# Execute the main command
exec "$@"
