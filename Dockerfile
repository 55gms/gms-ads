# --- Build the SPA -----------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Runtime -----------------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    MEDIA_DIR=/data/media
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY edge/lib ./edge/lib
COPY embed/dist ./embed/dist
COPY --from=build /app/web/dist ./web/dist
# The media directory is created and owned here so a named volume mounted at
# MEDIA_DIR starts out writable by the unprivileged user.
RUN mkdir -p /data/media && chown -R node:node /data
USER node
VOLUME ["/data/media"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
