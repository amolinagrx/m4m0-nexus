FROM postgres:16-bookworm
COPY init-scripts/ /docker-entrypoint-initdb.d/
COPY migrate.sh /opt/nexus/migrate.sh
