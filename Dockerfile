FROM node:18

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos
COPY package*.json ./
RUN npm install

COPY . .

# Koyeb usa el puerto 8000 para healthchecks
EXPOSE 8000

# Agregamos un retraso antes del chequeo de salud
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 CMD curl -f http://localhost:8000/health || exit 1

# Comando para ejecutar el bot
CMD ["npm", "start"]
