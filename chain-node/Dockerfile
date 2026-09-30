FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /chain-node .

FROM alpine:3.22
COPY --from=build /chain-node /usr/local/bin/chain-node
ENV DATA_FILE=/data/chain.json
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["chain-node"]
