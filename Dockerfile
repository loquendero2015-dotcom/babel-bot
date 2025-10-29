FROM node:18

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# No declaramos HEALTHCHECK para que Koyeb no valide
EXPOSE 8000

CMD ["npm", "start"]
