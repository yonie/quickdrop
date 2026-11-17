# Stage 1: compile QuickDrop into one static binary with the web app built in
FROM golang:1-alpine AS build
WORKDIR /src
COPY go.mod *.go ./
COPY public ./public
COPY modules ./modules
COPY samples ./samples
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /quickdrop .

# Stage 2: plain Alpine plus that one file
FROM alpine:3.23
RUN adduser -D -u 1000 quickdrop && mkdir /data && chown quickdrop /data
COPY --from=build /quickdrop /usr/local/bin/quickdrop
ENV PORT=3030 DATA_DIR=/data QUOTA_MB=100
USER quickdrop
EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q --spider http://127.0.0.1:3030/ || exit 1
CMD ["quickdrop"]
