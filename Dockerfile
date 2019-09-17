#
# Light LPM Dockerfile
#
# https://github.com/luminati-io/llpm
#

# Pull base image.
FROM node:8.11.2

USER root
RUN npm config set user root
RUN npm install -g npm@6.4.1

# Install Luminati Proxy Manager
RUN npm install -g @luminati-io/llpm

# Mark environment as Docker for CLI output
ENV DOCKER 1

# Define default command.
CMD ["llpm", "--help"]
