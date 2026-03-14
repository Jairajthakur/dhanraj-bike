FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY patches/ ./patches/

# Install all dependencies (need devDeps for esbuild)
RUN npm ci

# Copy source files
COPY server/ ./server/
COPY shared/ ./shared/
COPY migrations/ ./migrations/
COPY tsconfig.json ./
COPY drizzle.config.ts ./

# Build server → outputs server_dist/index.js
RUN npx esbuild server/index.ts \
    --platform=node \
    --packages=external \
    --bundle \
    --format=esm \
    --outdir=server_dist

EXPOSE 5000

CMD ["node", "server_dist/index.js"]
