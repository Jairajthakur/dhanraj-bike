FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY patches/ ./patches/
RUN npm install --legacy-peer-deps

# Server source
COPY server/ ./server/
COPY shared/ ./shared/
COPY migrations/ ./migrations/
COPY tsconfig.json ./
COPY drizzle.config.ts ./

# Expo app source, needed to produce the web build below
COPY app/ ./app/
COPY assets/ ./assets/
COPY components/ ./components/
COPY constants/ ./constants/
COPY contexts/ ./contexts/
COPY hooks/ ./hooks/
COPY lib/ ./lib/
COPY plugins/ ./plugins/
COPY app.json ./
COPY app.config.ts ./
COPY babel.config.cjs ./
COPY metro.config.cjs ./

# Web build: static-exports the app (login, dashboards, etc.) to ./dist so
# it can be served to regular browsers. The Expo Go "scan this QR code"
# page is separate and still lives at server/templates/landing-page.html.
RUN npx expo export -p web

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
