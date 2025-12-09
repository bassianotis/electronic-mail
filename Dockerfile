# Stage 1: Build the frontend AND server
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the frontend
RUN npm run build

# Build the server
WORKDIR /app/server
RUN npm ci
RUN npx tsc

# Stage 2: Production image
FROM node:20-alpine

WORKDIR /app

# Install production dependencies for server
COPY server/package.json server/package-lock.json ./server/
WORKDIR /app/server
RUN npm ci --omit=dev

# Copy built frontend from builder stage
COPY --from=builder /app/dist /app/public

# Copy COMPILED server code (JavaScript, not TypeScript)
COPY --from=builder /app/server/dist /app/server/dist

# Create data directory for SQLite
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/database.sqlite

# Start command - run the compiled JavaScript directly
WORKDIR /app/server
CMD ["node", "dist/index.js"]
