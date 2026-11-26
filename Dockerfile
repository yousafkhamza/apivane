# ApiVane local agent
#   docker run --rm -p 127.0.0.1:7878:7878 -v "$PWD:/work" ghcr.io/yousafkhamza/apivane
# Always publish to 127.0.0.1 only. The token is printed in the container log.
FROM node:22-alpine AS build
WORKDIR /src
COPY . .
RUN node scripts/build.mjs

FROM node:22-alpine
ENV NODE_ENV=production APIVANE_HOST=0.0.0.0 APIVANE_PORT=7878
COPY --from=build /src/packages/cli /app
WORKDIR /work
USER node
EXPOSE 7878
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:7878/ || exit 1
ENTRYPOINT ["node", "/app/bin/apivane.js"]
CMD ["serve", "--no-open", "--dir", "/work/.apivane"]
