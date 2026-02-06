FROM node:20-alpine

WORKDIR /app

# Install runtime deps
COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile

# Copy compiled output
COPY dist ./dist

# If your dist output needs other files, copy them too (rare)
# COPY some-folder ./some-folder

CMD ["node", "dist/mcp-server.js"]

