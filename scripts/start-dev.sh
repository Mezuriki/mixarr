#!/bin/sh
sudo docker compose -f ../docker-compose.dev.yml down
sudo docker compose -f ../docker-compose.dev.yml build --no-cache
sudo docker compose -f ../docker-compose.dev.yml up -d
