FROM node:18-alpine

# Install http-server globally
RUN npm install -g http-server

# Set working directory
WORKDIR /app

# Copy project files
COPY . .

# Expose port 8080
EXPOSE 8080

# Run http-server with SSL
# Requires cert.pem and key.pem to be present in the root (where this runs)
CMD ["http-server", ".", "-S", "-C", "cert.pem", "-K", "key.pem", "-p", "8080"]
