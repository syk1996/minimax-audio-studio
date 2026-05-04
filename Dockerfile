FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --fund=false --audit=false
COPY . .
EXPOSE 5173
VOLUME ["/app/data"]
CMD ["node", "server.js"]