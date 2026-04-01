# Use Node.js 18 (Bullseye required for some Matter native builds)
FROM node:18-bullseye

WORKDIR /app

# Copy package files first for caching
COPY package.json ./

# Install dependencies
RUN npm install

# Copy source code (Force Rebuild Layer)
COPY . .

# Expose Web Port (8080)
EXPOSE 8080

# Start server
CMD ["node", "matter-server.js"]
