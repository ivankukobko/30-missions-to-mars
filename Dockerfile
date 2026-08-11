FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application files
COPY . .

# Expose Vite default dev server port
EXPOSE 5173

# Default command to run Vite dev server bound to 0.0.0.0
CMD ["npm", "run", "dev", "--", "--host"]
