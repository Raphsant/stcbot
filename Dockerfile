# Use a lightweight Node.js image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy the rest of the app code
COPY . .

# Expose the port (internal use only)
EXPOSE 3000

# Start the bot
CMD ["node", "index.js"]


docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token eyJhIjoiZGM5N2MxYzc4MzlhZDY4MjU5NGU3Yzg1YjMxMDA2YjIiLCJ0IjoiOWIyYzRmMTUtY2VlNC00NzQwLWFlMzgtM2UxZjUwMzg0Y2VkIiwicyI6Ik5UQmtPV0U1TkRVdE1tUTJNQzAwTVRJd0xXRmlOemd0WTJFM016UmpZalEwTlRKaiJ9
