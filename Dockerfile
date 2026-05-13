FROM node:18-slim

WORKDIR /app

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/Aryan-verma-star/AI-human-discord.git .

RUN npm install --production

ENV PORT=3000
ENV AGENT_TIMEOUT=20

EXPOSE 3000

CMD ["node", "server.js"]