FROM node:18-alpine

WORKDIR /app

# Install git and curl
RUN apk add --no-cache git curl

# Clone the repository
RUN git clone https://github.com/Aryan-verma-star/AI-human-discord.git /app/code
WORKDIR /app/code

# Install dependencies
RUN npm install

# Copy .env.example to .env for setup (user must fill in actual values)
RUN cp .env.example .env

# Expose port
EXPOSE 3000

# Default command - run the HTTP server
CMD ["npm", "run", "server"]