FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
COPY patches/ ./patches/
RUN npm ci

COPY server/ ./server/
COPY shared/ ./shared/
COPY migrations/ ./migrations/
COPY tsconfig.json ./
COPY drizzle.config.ts ./

RUN npx esbuild server/index.ts \
    --platform=node \
    --packages=external \
    --bundle \
    --format=esm \
    --outdir=server_dist

RUN mkdir -p server_dist/templates && \
    cp -r server/templates/* server_dist/templates/ 2>/dev/null || true

EXPOSE 8080

CMD ["sh", "-c", "npx drizzle-kit push --force && node server_dist/index.js || node server_dist/index.js"]
