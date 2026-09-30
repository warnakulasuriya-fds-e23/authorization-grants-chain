FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /api .

FROM alpine:3.22
WORKDIR /app
COPY --from=build /api /usr/local/bin/api
COPY openapi.yaml ./
EXPOSE 8000
ENTRYPOINT ["api"]
