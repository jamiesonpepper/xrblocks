FROM node:18

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code (Force Rebuild Layer)
COPY . .

# Generate self-signed TLS cert with SAN (required for WebXR secure context).
# Override SERVER_IP at build time for on-device access:
#   docker build --build-arg SERVER_IP=192.168.x.x ...
ARG SERVER_IP=127.0.0.1
RUN openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes \
    -subj "/CN=${SERVER_IP}" \
    -addext "subjectAltName=IP:${SERVER_IP},IP:127.0.0.1,DNS:localhost"

# Expose Web Port (HTTPS for WebXR secure context)
EXPOSE 8443

# Start server
CMD ["node", "matter-server.js"]
