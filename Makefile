# Variables
COMPOSE_FILE = compose.yml
PROJECT_NAME = ft_transcendence

.PHONY: all up build start down stop logs ps re clean fclean help

all: up

up:
	@echo "Starting up $(PROJECT_NAME) services..."
	docker compose -f $(COMPOSE_FILE) --project-name $(PROJECT_NAME) up --build -d
	@printf "\e[32m🚀 https://localhost:8443/ on nginx\e[m\n"

build:
	@echo "Building $(PROJECT_NAME) services..."
	docker compose -f $(COMPOSE_FILE) --project-name $(PROJECT_NAME) build

start:
	@echo "Starting $(PROJECT_NAME) services (without rebuilding)..."
	docker compose -f $(COMPOSE_FILE) --project-name $(PROJECT_NAME) up -d

down:
	@echo "Stopping $(PROJECT_NAME) services..."
	docker compose -f $(COMPOSE_FILE) --project-name $(PROJECT_NAME) down

stop: down

logs:
	@echo "Showing logs for $(PROJECT_NAME) services..."
	docker compose -f $(COMPOSE_FILE) --project-name $(PROJECT_NAME) logs -f

ps:
	@echo "Listing running services for $(PROJECT_NAME)..."
	docker compose -f $(COMPOSE_FILE) --project-name $(PROJECT_NAME) ps

re:
	@echo "Rebuilding and restarting $(PROJECT_NAME) services..."
	$(MAKE) down
	$(MAKE) up

RE: bals all

clean:
	@echo "Stopping and removing containers for $(PROJECT_NAME)..."
	docker compose -f $(COMPOSE_FILE) --project-name $(PROJECT_NAME) down -v --remove-orphans

fclean:
	@echo "Cleaning all: stopping containers, removing volumes, images, and orphans for $(PROJECT_NAME)..."
	docker compose -f $(COMPOSE_FILE) --project-name $(PROJECT_NAME) down -v --rmi all --remove-orphans
	@echo "Removing frontend_dist volume if it exists..."
	docker volume rm $(PROJECT_NAME)_frontend_dist || true
	@echo "Pruning unused Docker data..."
	docker system prune -af || true

bals:
	@docker stop $$(docker ps -q) 2>/dev/null || true
	@docker rm -f $$(docker ps -a -q) 2>/dev/null || true
	@docker rmi -f $$(docker images -q) 2>/dev/null || true
	@docker volume rm $$(docker volume ls -q) 2>/dev/null || true
	@docker network rm $$(docker network ls -q --filter type=custom) 2>/dev/null || true
	@docker system prune -a -f --volumes > /dev/null 2>&1 || true
	@echo "bals!"

# webserv:
# 	@ ./secrets/.webserv.sh

help:
	@echo "Available commands for $(PROJECT_NAME):"
	@echo "  make all         - Build and start all services (default)."
	@echo "  make up          - Build (if necessary) and start all services in detached mode."
	@echo "  make build       - Build or rebuild services."
	@echo "  make start       - Start services without rebuilding."
	@echo "  make down        - Stop and remove containers."
	@echo "  make stop        - Alias for 'down'."
	@echo "  make logs        - Follow log output."
	@echo "  make ps          - List containers."
	@echo "  make re          - Rebuild and restart all services (down then up)."
	@echo "  make clean       - Stop and remove containers, and remove named volumes."
	@echo "  make fclean      - Stop containers, remove volumes, remove images used by services, and remove orphans. Also prunes system."
	@echo "  make help        - Show this help message."

# Prevent .PHONY targets from interfering with files of the same name
.DEFAULT_GOAL := help
