FROM node:26-bookworm-slim

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY . .
RUN npm run build --workspace @routecommand/shared

EXPOSE 3000
CMD ["npm", "run", "dev", "--workspace", "@routecommand/api"]
