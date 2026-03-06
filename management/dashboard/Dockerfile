FROM node:20-alpine
RUN apk add --no-cache bash openssh-client curl redis docker-cli kubectl
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
EXPOSE 3500
CMD ["node", "server.js"]
