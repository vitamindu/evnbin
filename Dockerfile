# FIGHT GUYS 게임 서버(server/). 웹 클라이언트는 따로(GitHub Pages 등) 배포한다.
#   docker build -t fight-guys-server .
#   docker run --init -p 8787:8787 fight-guys-server
# 환경 변수: PORT(기본 8787), ALLOWED_ORIGINS(쉼표 구분, 비우면 모두 허용) — server/README.md 참고

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run server:build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787
COPY package.json package-lock.json ./
# 번들은 외부 패키지(ws)만 node_modules에서 읽는다
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["npm", "run", "server:start"]
